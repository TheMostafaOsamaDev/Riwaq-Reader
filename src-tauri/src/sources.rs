// Rust-side primitives for the Sources (extension) subsystem.
//
// Two commands are exposed to the frontend:
//
//   source_fetch              static HTTP. CORS-free since this runs in Rust,
//                             with caller-controlled headers/method/body. The
//                             frontend uses this for sites whose data lives
//                             in the initial HTML. Works on desktop AND
//                             mobile (Android, iOS).
//
//   source_render_and_extract spawns a hidden WebviewWindow, navigates it to
//                             the target URL, runs a caller-provided JS
//                             predicate-then-extractor inside the page, and
//                             returns the extracted JSON. Used for sites that
//                             render content via JS after page load. DESKTOP
//                             ONLY — mobile Tauri (Android/iOS) doesn't
//                             support spawning hidden secondary windows, so
//                             WebviewWindowBuilder lacks `.visible(false)`
//                             on those targets. The mobile stub returns
//                             a clear error if any source ever calls this
//                             path; in practice the KolNovel scraper does
//                             everything via static fetch and never hits it.
//
// Exfiltration from the headless webview is done via `document.title`. The
// init script wraps the caller's predicate + extractor in a wait loop, then
// stamps the result onto `document.title` with a fixed prefix. Rust polls
// the title via WebviewWindow::title() and looks for the prefix. Title is
// the only channel that (a) requires no Tauri runtime in the page, (b) has
// no CORS surface, and (c) is reliably readable from the Rust side for an
// externally-loaded URL.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(desktop)]
use std::time::Duration;
#[cfg(desktop)]
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
const TITLE_DATA_PREFIX: &str = "__LEAFLET_DATA__:";
#[cfg(desktop)]
const TITLE_ERROR_PREFIX: &str = "__LEAFLET_ERROR__:";

#[derive(Debug, Serialize)]
pub struct FetchResponse {
    status: u16,
    text: String,
    headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct FetchOptions {
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Option<HashMap<String, String>>,
    #[serde(default)]
    body: Option<String>,
}

#[tauri::command]
pub async fn source_fetch(
    url: String,
    options: Option<FetchOptions>,
) -> Result<FetchResponse, String> {
    let opts = options.unwrap_or(FetchOptions {
        method: None,
        headers: None,
        body: None,
    });
    let client = build_client()?;
    let method = opts.method.as_deref().unwrap_or("GET").to_uppercase();
    let parsed_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Invalid method '{method}': {e}"))?;

    let mut req = client.request(parsed_method, &url);
    if let Some(hdrs) = opts.headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    if let Some(body) = opts.body {
        req = req.body(body);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(s) = v.to_str() {
            headers.insert(k.as_str().to_lowercase(), s.to_string());
        }
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(FetchResponse {
        status,
        text,
        headers,
    })
}

#[tauri::command]
pub async fn source_fetch_bytes(
    url: String,
    options: Option<FetchOptions>,
) -> Result<Vec<u8>, String> {
    let opts = options.unwrap_or(FetchOptions {
        method: None,
        headers: None,
        body: None,
    });
    let client = build_client()?;
    let method = opts.method.as_deref().unwrap_or("GET").to_uppercase();
    let parsed_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Invalid method '{method}': {e}"))?;
    let mut req = client.request(parsed_method, &url);
    if let Some(hdrs) = opts.headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status} for {url}"));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

// Fields here are all used by serde's deserializer + by the desktop
// implementation. On mobile we keep the same shape so the JS frontend
// can call the stub identically, but the fields don't get touched —
// suppress the dead-code warning there.
#[cfg_attr(not(desktop), allow(dead_code))]
#[derive(Debug, Deserialize)]
pub struct RenderExtractInput {
    url: String,
    #[serde(default, rename = "waitForPredicate")]
    wait_for_predicate: Option<String>,
    #[serde(default, rename = "waitForSelector")]
    wait_for_selector: Option<String>,
    script: String,
    #[serde(default, rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

#[cfg(desktop)]
#[tauri::command]
pub async fn source_render_and_extract(
    app: AppHandle,
    input: RenderExtractInput,
) -> Result<String, String> {
    let timeout_ms = input.timeout_ms.unwrap_or(30_000);
    let predicate_js = build_predicate_js(&input);
    let init_script = build_init_script(&predicate_js, &input.script, timeout_ms);

    let parsed_url: url::Url = input
        .url
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid URL: {e}"))?;
    let label = format!(
        "leaflet-scraper-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    );

    // WebviewWindowBuilder is `!Send` because it captures handle to the
    // Tauri runtime; run construction on the main thread. The handle to
    // the built window IS Send so we keep it across the .await on the
    // poll loop.
    let label_for_build = label.clone();
    let app_for_build = app.clone();
    let window = tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        // Inner clone — `run_on_main_thread` moves its closure but we also
        // need `app_for_build` to outlive the dispatch call so the borrow
        // checker is happy. The clone is cheap; AppHandle is a thin
        // refcount wrapper.
        let app_inner = app_for_build.clone();
        let _ = app_for_build.run_on_main_thread(move || {
            let result = WebviewWindowBuilder::new(
                &app_inner,
                &label_for_build,
                WebviewUrl::External(parsed_url),
            )
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .initialization_script(&init_script)
            .build();
            let _ = tx.send(result.map_err(|e| e.to_string()));
        });
        rx.recv()
            .map_err(|e| format!("window-builder channel: {e}"))?
    })
    .await
    .map_err(|e| format!("window-builder join: {e}"))??;

    // Poll the window title until our prefix appears or we exceed the
    // hard ceiling (predicate timeout + a generous 10s for page load).
    let poll_until = std::time::Instant::now()
        + Duration::from_millis(timeout_ms + 10_000);
    let outcome = loop {
        if std::time::Instant::now() > poll_until {
            break Err("source_render_and_extract: window timed out".into());
        }
        match window.title() {
            Ok(title) => {
                if let Some(rest) = title.strip_prefix(TITLE_DATA_PREFIX) {
                    break Ok(rest.to_string());
                }
                if let Some(rest) = title.strip_prefix(TITLE_ERROR_PREFIX) {
                    break Err(
                        urlencoding::decode(rest)
                            .map(|s| s.into_owned())
                            .unwrap_or_else(|_| rest.to_string()),
                    );
                }
            }
            Err(e) => {
                // Window destroyed mid-poll — treat as a load failure.
                break Err(format!("title-read failed: {e}"));
            }
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    };

    // Always tear the window down — failure to close leaks a hidden
    // window that the user can't dismiss.
    let _ = window.close();
    outcome
}

/// Mobile stub. WebviewWindowBuilder on Android / iOS lacks `.visible()`
/// (Tauri's mobile runtime only supports a single foreground webview),
/// so the headless-render path is desktop-only. Sources that need
/// JS-rendered pages on mobile will see this error and can either fall
/// back to static fetch or surface a UI message; the bundled KolNovel
/// scraper does all of its work via `source_fetch` and never hits this.
#[cfg(not(desktop))]
#[tauri::command]
pub async fn source_render_and_extract(
    _input: RenderExtractInput,
) -> Result<String, String> {
    Err(
        "Headless render-and-extract isn't available on mobile — this \
         source requires a desktop build to fetch JS-rendered pages."
            .to_string(),
    )
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Leaflet/0.1",
        )
        .gzip(true)
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn build_predicate_js(input: &RenderExtractInput) -> String {
    // If both predicate and selector are given, predicate wins. If neither
    // is given, default to document.readyState === 'complete'.
    if let Some(p) = &input.wait_for_predicate {
        return p.clone();
    }
    if let Some(sel) = &input.wait_for_selector {
        // Wait for the selector to exist AND the matched element(s) to
        // have non-empty textContent. This is what the KolNovel scraper
        // explicitly wants: the DOM may have the <p> tags but the chapter
        // text loads via JS shortly after.
        let escaped = sel.replace('\\', "\\\\").replace('"', "\\\"");
        return format!(
            r#"
            const els = document.querySelectorAll("{sel}");
            if (els.length === 0) return false;
            for (const el of els) {{
              if ((el.textContent || "").trim().length > 0) return true;
            }}
            return false;
            "#,
            sel = escaped,
        );
    }
    "return document.readyState === 'complete'".to_string()
}

#[cfg(desktop)]
fn build_init_script(predicate_js: &str, script_js: &str, timeout_ms: u64) -> String {
    // Run as soon as the document is available. The wrapping IIFE swallows
    // errors and reports them via the title channel instead of crashing
    // the page. We re-stamp the title via setInterval as a defensive
    // measure: many sites mutate document.title later (e.g. "(3) Page —
    // Site"), and our payload must survive that for Rust to read it.
    format!(
        r#"
(function() {{
  const DATA_PREFIX = "{data_prefix}";
  const ERROR_PREFIX = "{error_prefix}";
  const TIMEOUT_MS = {timeout_ms};

  function setReport(prefix, value) {{
    const tag = prefix + value;
    document.title = tag;
    // Page scripts often mutate the title after load. Pin ours so the
    // Rust poll sees it for at least a couple cycles.
    setInterval(function() {{
      if (document.title !== tag) {{
        document.title = tag;
      }}
    }}, 100);
  }}

  function predicate() {{
    try {{
      return (function() {{ {predicate_js} }})();
    }} catch (e) {{
      return false;
    }}
  }}

  async function run() {{
    const started = Date.now();
    while (true) {{
      if (predicate()) break;
      if (Date.now() - started > TIMEOUT_MS) {{
        setReport(ERROR_PREFIX, encodeURIComponent("Predicate timeout after " + TIMEOUT_MS + "ms"));
        return;
      }}
      await new Promise(function(r) {{ setTimeout(r, 150); }});
    }}
    let result;
    try {{
      result = await (async function() {{ {script_js} }})();
    }} catch (e) {{
      setReport(ERROR_PREFIX, encodeURIComponent(String(e && e.message ? e.message : e)));
      return;
    }}
    let encoded;
    try {{
      encoded = JSON.stringify(result);
    }} catch (e) {{
      setReport(ERROR_PREFIX, encodeURIComponent("Result not JSON-serializable: " + String(e)));
      return;
    }}
    if (encoded === undefined) encoded = "null";
    setReport(DATA_PREFIX, encoded);
  }}

  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", function() {{ run(); }}, {{ once: true }});
  }} else {{
    run();
  }}
}})();
"#,
        data_prefix = TITLE_DATA_PREFIX,
        error_prefix = TITLE_ERROR_PREFIX,
        timeout_ms = timeout_ms,
        predicate_js = predicate_js,
        script_js = script_js,
    )
}
