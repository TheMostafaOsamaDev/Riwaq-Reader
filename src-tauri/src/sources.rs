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
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
const TITLE_DATA_PREFIX: &str = "__LEAFLET_DATA__:";
#[cfg(desktop)]
const TITLE_ERROR_PREFIX: &str = "__LEAFLET_ERROR__:";

// Deserialize is needed as well as Serialize: the session-webview
// transport receives this same shape back as JSON from the page.
#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResponse {
    status: u16,
    text: String,
    headers: HashMap<String, String>,
}

impl FetchResponse {
    /// Read accessors used by the dev self-test harness in lib.rs.
    pub fn status_for_test(&self) -> u16 {
        self.status
    }
    pub fn text_for_test(&self) -> &str {
        &self.text
    }
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


// ── session webview: fetching from a challenge-protected origin ─────────────
//
// Some sources sit behind a Cloudflare *managed challenge* that no plain
// HTTP client can satisfy. cenele.com is the motivating case: since
// 2026-08-28 every `/cont/*` URL answers a reqwest GET with 403 +
// `cf-mitigated: challenge`.
//
// Cookie harvesting does NOT solve this. A `cf_clearance` cookie taken
// from a real browser still gets 403 when replayed by reqwest with the
// byte-identical User-Agent — Cloudflare binds the clearance to the
// TLS/HTTP2 fingerprint, so only a real browser engine can spend it.
//
// So we don't move the credential to the request; we move the request to
// the credential. A webview is parked on the origin, clears the challenge
// once (it self-clears in a few seconds), and every later fetch runs as
// same-origin `fetch()` *inside* that page — the clearance, cookie jar
// and TLS fingerprint are then all genuinely the browser's. If a
// challenge ever needs a human, the window is shown so the user can
// solve it, then hidden again.
//
// The window is kept alive across calls and keyed by origin, so one
// clearance serves the whole session.
//
// ## The landing URL must itself be challenged
//
// The session window navigates to the *first requested URL*, not to the
// origin root. Clearance is only granted by passing a challenge, and on
// cenele the root is unprotected — landing there would yield a cleanly
// loaded page and no `cf_clearance` at all, so the first real `/cont/`
// fetch would still come back as the interstitial.
//
// ## Why the URL fragment, and not IPC or the window title
//
// Tauri 2 can grant remote pages IPC access via a capability `remote`
// entry. We deliberately don't. This webview loads a third-party page
// that runs ad and analytics scripts; IPC would expose our whole
// invoke_handler to it — including `source_fetch`, an arbitrary-HTTP
// primitive — plus the fs and opener plugins. The page stays sandboxed
// and talks to us through a one-way channel it cannot use to reach
// anything: its own URL fragment, which `WebviewWindow::url()` reports.
//
// `document.title` is NOT that channel, despite what the older
// render-and-extract path above assumes. On macOS `WebviewWindow::title()`
// returns the *window's* title ("Tauri App") and never reflects
// `document.title`, so that path cannot work as written — measured, not
// guessed. Leaving the title alone also keeps it usable as the signal
// that tells an interstitial apart from a real page.
//
// Payloads are base64url'd page-side (base64url so no character needs
// percent-escaping in a fragment) and handed over in slices, since a URL
// cannot hold a 300KB chapter page. Slices are cut at multiples of 4 so
// each decodes independently.

#[cfg(desktop)]
const SESSION_READY: &str = "__LEAFLET_READY__";
#[cfg(desktop)]
const SESSION_WAIT: &str = "__LEAFLET_WAIT__";
#[cfg(desktop)]
const SESSION_LEN: &str = "__LEAFLET_LEN__:";
#[cfg(desktop)]
const SESSION_CHUNK: &str = "__LEAFLET_CHUNK__:";
#[cfg(desktop)]
const SESSION_ERR: &str = "__LEAFLET_ERR__:";
/// Base64 characters per fragment hand-off. Multiple of 4 so every slice
/// decodes on its own. Sized to keep a ~450KB chapter to single-digit
/// round trips — at 8KB a chapter cost ~6s in transfer alone.
#[cfg(desktop)]
const SESSION_CHUNK_SIZE: usize = 65_536;

#[cfg_attr(not(desktop), allow(dead_code))]
#[derive(Debug, Deserialize)]
pub struct SessionFetchInput {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Option<HashMap<String, String>>,
    #[serde(default)]
    body: Option<String>,
    /// How long to wait for the challenge to self-clear before showing the
    /// window to the user. Default 6s.
    #[serde(default, rename = "revealAfterMs")]
    reveal_after_ms: Option<u64>,
    /// Ceiling for clearing the challenge, including the user's own time.
    /// Default 180s.
    #[serde(default, rename = "clearTimeoutMs")]
    clear_timeout_ms: Option<u64>,
}

/// One lock per origin, held for a whole fetch — acquisition *and* the
/// request/transfer that follows.
///
/// A source fires several fetches per novel (the page, then admin-ajax)
/// and they overlap. Two things break without this:
///
///   1. Both callers see "no session yet" and race to build the same
///      window label; the loser fails with "a webview with label ...
///      already exists".
///   2. Worse and quieter: the page-side bridge has a *single* payload
///      slot (`_b64`). Two overlapping requests clobber each other, so
///      the length Rust was told stops matching the string being sliced
///      and the transfer ends up short. A single-slot bridge simply
///      cannot serve two requests at once.
///
/// Per-origin rather than global so a slow challenge on one host doesn't
/// stall fetches to another.
#[cfg(desktop)]
static SESSION_LOCKS: std::sync::OnceLock<
    std::sync::Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::OnceLock::new();

#[cfg(desktop)]
fn origin_lock(origin: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    let map = SESSION_LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    guard.entry(origin.to_string()).or_default().clone()
}

/// Window label for an origin. Deterministic, so the window itself is the
/// registry — no separate bookkeeping to fall out of sync with reality.
#[cfg(desktop)]
fn session_label(origin: &str) -> String {
    format!(
        "leaflet-session-{}",
        origin
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
    )
}

/// The page-side half of the bridge. Installed as an initialization
/// script so it re-runs on every navigation — including the reload
/// Cloudflare performs once its challenge clears.
#[cfg(desktop)]
fn session_bridge_script() -> String {
    format!(
        r#"
(function () {{
  if (window.__leafletBridge) return;
  var B = window.__leafletBridge = {{
    _state: "{wait}",
    _written: null,
    _b64: "",
    // The channel is the fragment: replaceState doesn't navigate, and
    // WebviewWindow::url() reports the result.
    _set: function (t) {{ B._state = t; B._flush(); }},
    // Write the fragment only when it actually changed. WebKit rate-limits
    // history calls (~100 per 30s) and then throws; writing on every host
    // poll — and on every repeated WAIT while a challenge clears — burns
    // that budget in seconds, after which the fragment silently freezes on
    // a stale value and the host spins until it times out. Tracking what
    // we last wrote (rather than comparing location.hash, which can come
    // back percent-encoded) keeps it to one write per distinct state, and
    // leaves _written unset if the call throws so the next poll retries.
    _flush: function () {{
      if (B._written === B._state) return;
      try {{
        history.replaceState(null, '', '#' + B._state);
        B._written = B._state;
      }} catch (e) {{}}
    }},
    // Re-assert our fragment. The host calls this before every read, so
    // a site script that rewrites the URL can't swallow a response.
    poll: function () {{ B._flush(); }},
    // Cloudflare's interstitial, told apart from a real page. Matching on
    // a challenges.cloudflare.com <script> would false-positive: ordinary
    // pages embed that too, for Turnstile widgets.
    isInterstitial: function () {{
      return /^Just a moment/i.test(document.title || "")
        || !!document.querySelector(
             '#challenge-form, #challenge-running, #challenge-stage, #cf-chl-widget');
    }},
    probe: function () {{
      var done = document.readyState === "complete";
      B._set(done && !B.isInterstitial() ? "{ready}" : "{wait}");
    }},
    request: function (reqJson) {{
      var req;
      try {{ req = JSON.parse(decodeURIComponent(reqJson)); }}
      catch (e) {{ B._set("{err}" + encodeURIComponent("bad request json")); return; }}
      var init = {{ method: req.method || "GET", credentials: "include" }};
      if (req.headers) init.headers = req.headers;
      if (typeof req.body === "string") init.body = req.body;
      fetch(req.url, init).then(function (resp) {{
        return resp.text().then(function (text) {{
          var headers = {{}};
          resp.headers.forEach(function (v, k) {{ headers[String(k).toLowerCase()] = v; }});
          B._b64 = B._encode(JSON.stringify({{
            status: resp.status, headers: headers, text: text,
          }}));
          B._set("{len}" + B._b64.length);
        }});
      }}).catch(function (e) {{
        B._set("{err}" + encodeURIComponent(String((e && e.message) || e)));
      }});
    }},
    chunk: function (start, size) {{
      B._set("{chunk}" + start + ":" + B._b64.substr(start, size));
    }},
    // base64url: '+' and '/' would have to be percent-escaped inside a
    // fragment, so swap them out. btoa() needs a binary string, and
    // spreading a 300KB byte array into String.fromCharCode overflows the
    // argument stack — so walk the UTF-8 bytes in blocks.
    _encode: function (s) {{
      var bytes = new TextEncoder().encode(s), bin = "", N = 0x8000;
      for (var i = 0; i < bytes.length; i += N) {{
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + N));
      }}
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
    }},
  }};
}})();
"#,
        wait = SESSION_WAIT,
        ready = SESSION_READY,
        len = SESSION_LEN,
        chunk = SESSION_CHUNK,
        err = SESSION_ERR,
    )
}

/// Origin ("https://host[:port]") of a URL — the session key.
#[cfg(desktop)]
fn origin_of(url: &url::Url) -> String {
    match url.port() {
        Some(p) => format!("{}://{}:{}", url.scheme(), url.host_str().unwrap_or(""), p),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")),
    }
}

/// Ask the page to re-assert its fragment, then read it back.
#[cfg(desktop)]
async fn read_state(window: &tauri::WebviewWindow) -> Result<String, String> {
    let _ = window.eval("window.__leafletBridge && window.__leafletBridge.poll()");
    tokio::time::sleep(Duration::from_millis(20)).await;
    let url = window.url().map_err(|e| format!("url-read failed: {e}"))?;
    Ok(url.fragment().unwrap_or("").to_string())
}

/// Get the live session window for `origin`, creating it (landed on
/// `landing_url`) if there isn't one, and return it only once it is past
/// the challenge.
#[cfg(desktop)]
async fn acquire_session(
    app: &AppHandle,
    origin: &str,
    landing_url: &str,
    reveal_after: Duration,
    clear_timeout: Duration,
) -> Result<tauri::WebviewWindow, String> {
    // Caller holds the origin lock (see SESSION_LOCKS), so no two
    // acquisitions for this origin can be in flight at once.
    let label = session_label(origin);

    // The window is its own registry. If one is already up (this call
    // overlapped another, or an earlier fetch left it), adopt it; the
    // readiness probe below re-confirms it rather than trusting it.
    let window = match app.get_webview_window(&label) {
        Some(w) => w,
        None => {
            // Land on the URL we were actually asked for — see the note
            // above on why the origin root is the wrong landing page.
            let parsed: url::Url = landing_url.parse().map_err(|e: url::ParseError| {
                format!("Invalid URL '{landing_url}': {e}")
            })?;
            let script = session_bridge_script();
            // WebviewWindowBuilder is !Send, so build it on the main
            // thread and ship the (Send) handle back.
            let app_for_build = app.clone();
            let label_for_build = label.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let (tx, rx) = std::sync::mpsc::channel();
                let app_inner = app_for_build.clone();
                let _ = app_for_build.run_on_main_thread(move || {
                    let result = WebviewWindowBuilder::new(
                        &app_inner,
                        &label_for_build,
                        WebviewUrl::External(parsed),
                    )
                    .title("Verifying your browser…")
                    .inner_size(480.0, 640.0)
                    .visible(false)
                    .skip_taskbar(true)
                    .focused(false)
                    .initialization_script(&script)
                    .build();
                    let _ = tx.send(result.map_err(|e| e.to_string()));
                });
                rx.recv()
                    .map_err(|e| format!("session window channel: {e}"))?
            })
            .await
            .map_err(|e| format!("session window join: {e}"))??
        }
    };

    // Wait out the challenge. It normally self-clears; if it hasn't by
    // `reveal_after` it wants a human, so show the window and keep
    // waiting while they solve it. On an already-cleared session this
    // returns on the first pass.
    let started = std::time::Instant::now();
    let mut revealed = false;
    loop {
        if started.elapsed() > clear_timeout {
            // Tear the window down so the next attempt starts clean
            // instead of adopting a wedged one.
            let _ = window.close();
            return Err(format!(
                "Timed out waiting for {origin} to clear its browser check."
            ));
        }
        let _ = window.eval("window.__leafletBridge && window.__leafletBridge.probe()");
        tokio::time::sleep(Duration::from_millis(80)).await;
        if let Ok(u) = window.url() {
            if u.fragment().unwrap_or("") == SESSION_READY {
                break;
            }
        }
        if !revealed && started.elapsed() > reveal_after {
            revealed = true;
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("source-session-challenge", origin);
        }
    }
    if revealed {
        let _ = window.hide();
        let _ = app.emit("source-session-cleared", origin);
    }

    Ok(window)
}

/// Prefix on the error returned when an origin's clearance has lapsed and
/// re-clearing it needs the user. The frontend matches on this to tell
/// "verify again" apart from an ordinary network failure.
pub const SESSION_EXPIRED: &str = "SESSION_EXPIRED:";

/// True when a response is Cloudflare's interstitial rather than the page
/// we asked for. Inside a session this means the clearance lapsed
/// mid-session — the request went out from a real browser and still came
/// back challenged.
#[cfg(desktop)]
fn looks_like_challenge(resp: &FetchResponse) -> bool {
    if resp
        .headers
        .get("cf-mitigated")
        .is_some_and(|v| v.eq_ignore_ascii_case("challenge"))
    {
        return true;
    }
    (resp.status == 403 || resp.status == 503)
        && resp.text.contains("challenges.cloudflare.com")
        && resp.text.contains("Just a moment")
}

/// Issue one request inside an already-cleared session window and pull
/// the response back over the fragment channel.
#[cfg(desktop)]
async fn run_session_request(
    window: &tauri::WebviewWindow,
    input: &SessionFetchInput,
) -> Result<FetchResponse, String> {
    let req = serde_json::json!({
        "url": input.url,
        "method": input.method.clone().unwrap_or_else(|| "GET".into()),
        "headers": input.headers.clone().unwrap_or_default(),
        "body": input.body,
    })
    .to_string();
    // Hand the request over percent-encoded so quotes and Arabic text in
    // the body can't break out of the JS string literal.
    let encoded = urlencoding::encode(&req).into_owned();
    window
        .eval(&format!(
            "window.__leafletBridge && window.__leafletBridge.request(\"{encoded}\")"
        ))
        .map_err(|e| format!("dispatch failed: {e}"))?;

    // Wait for the page to report the encoded length (or an error).
    let t_dispatch = std::time::Instant::now();
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let total: usize = loop {
        if std::time::Instant::now() > deadline {
            return Err(format!("Timed out fetching {} in session webview", input.url));
        }
        let state = read_state(window).await?;
        if let Some(rest) = state.strip_prefix(SESSION_LEN) {
            break rest.parse().map_err(|_| format!("bad length header: {rest}"))?;
        }
        if let Some(rest) = state.strip_prefix(SESSION_ERR) {
            return Err(urlencoding::decode(rest)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| rest.to_string()));
        }
    };
    let fetch_ms = t_dispatch.elapsed().as_millis();
    let t_chunks = std::time::Instant::now();

    // Pull the base64url across in slices.
    let mut b64 = String::with_capacity(total);
    while b64.len() < total {
        let start = b64.len();
        let want = SESSION_CHUNK_SIZE.min(total - start);
        window
            .eval(&format!(
                "window.__leafletBridge && window.__leafletBridge.chunk({start},{want})"
            ))
            .map_err(|e| format!("chunk dispatch failed: {e}"))?;
        let expect = format!("{SESSION_CHUNK}{start}:");
        let chunk_deadline = std::time::Instant::now() + Duration::from_secs(20);
        loop {
            if std::time::Instant::now() > chunk_deadline {
                return Err(format!("Timed out reading chunk at {start}"));
            }
            let state = read_state(window).await?;
            if let Some(rest) = state.strip_prefix(&expect) {
                if rest.len() != want {
                    return Err(format!(
                        "Session chunk at {start} came back {} chars, expected {want} \
                         — the URL channel truncated it.",
                        rest.len()
                    ));
                }
                b64.push_str(rest);
                break;
            }
        }
    }

    if std::env::var("LEAFLET_SESSION_SELFTEST").is_ok() {
        println!(
            "[session-phases] in_page_fetch={}ms chunk_transfer={}ms chunks={}",
            fetch_ms,
            t_chunks.elapsed().as_millis(),
            total.div_ceil(SESSION_CHUNK_SIZE),
        );
    }

    use base64::Engine as _;
    let standard = b64.replace('-', "+").replace('_', "/");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(standard.as_bytes())
        .map_err(|e| format!("base64 decode: {e}"))?;
    let json = String::from_utf8(bytes).map_err(|e| format!("utf8 decode: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("response decode: {e}"))
}

/// Fetch a URL from inside a cleared session webview for its origin.
/// Returns the same shape as `source_fetch`, so a source can swap
/// transports without touching its parsing.
///
/// Clearance lapses over time. When a request comes back challenged even
/// though it went out from a real browser, the session is stale: the
/// window is torn down and rebuilt once, which re-runs the challenge
/// (silently if it self-clears, visibly if it needs the user). Only if
/// that second attempt is still challenged do we surface SESSION_EXPIRED,
/// so a lapse mid-download costs a pause rather than a failed batch.
#[cfg(desktop)]
#[tauri::command]
pub async fn source_session_fetch(
    app: AppHandle,
    input: SessionFetchInput,
) -> Result<FetchResponse, String> {
    let parsed: url::Url = input
        .url
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid URL: {e}"))?;
    let origin = origin_of(&parsed);
    // Held across acquire + request + chunk transfer: the bridge has one
    // payload slot, so requests to an origin must not interleave.
    let lock = origin_lock(&origin);
    let _guard = lock.lock().await;
    let reveal_after = Duration::from_millis(input.reveal_after_ms.unwrap_or(6_000));
    let clear_timeout = Duration::from_millis(input.clear_timeout_ms.unwrap_or(180_000));

    for attempt in 0..2 {
        let window =
            acquire_session(&app, &origin, &input.url, reveal_after, clear_timeout).await?;
        let resp = run_session_request(&window, &input).await?;
        if !looks_like_challenge(&resp) {
            return Ok(resp);
        }
        if attempt == 0 {
            // Stale clearance. Drop the window so acquire_session builds a
            // fresh one and re-runs the challenge.
            let _ = window.close();
            let _ = app.emit("source-session-expired", &origin);
            continue;
        }
        return Err(format!(
            "{SESSION_EXPIRED} {origin} needs its browser check completed again."
        ));
    }
    unreachable!("session fetch loop always returns")
}

/// Mobile stub. Android needs a native `android.webkit.WebView` driven
/// through a Kotlin plugin rather than a second Tauri window; until that
/// lands, challenge-protected sources are desktop-only.
#[cfg(not(desktop))]
#[tauri::command]
pub async fn source_session_fetch(
    _input: SessionFetchInput,
) -> Result<FetchResponse, String> {
    Err("This source needs an in-app browser session, which isn't available \
         on mobile yet."
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact payload `host.ts::sessionFetch` puts on the wire. If the
    /// camelCase renames or the flattened option fields ever drift from
    /// the TS side, this fails instead of every source failing at runtime.
    #[test]
    fn session_input_matches_frontend_payload() {
        let json = serde_json::json!({
            "url": "https://cenele.com/cont/x/",
            "method": "POST",
            "headers": { "Content-Type": "application/x-www-form-urlencoded" },
            "body": "action=nhv_manga_single_chapters_page",
            "revealAfterMs": 6000,
            "clearTimeoutMs": 180000,
        });
        let input: SessionFetchInput =
            serde_json::from_value(json).expect("frontend payload must deserialize");
        assert_eq!(input.url, "https://cenele.com/cont/x/");
        assert_eq!(input.method.as_deref(), Some("POST"));
        assert_eq!(input.reveal_after_ms, Some(6_000));
        assert_eq!(input.clear_timeout_ms, Some(180_000));
        assert_eq!(
            input.headers.unwrap().get("Content-Type").map(String::as_str),
            Some("application/x-www-form-urlencoded")
        );
    }

    /// A bare GET — `normalizeFetchOptions` returns null, so every
    /// optional field is simply absent.
    #[test]
    fn session_input_accepts_bare_get() {
        let input: SessionFetchInput =
            serde_json::from_value(serde_json::json!({ "url": "https://cenele.com/cont/x/" }))
                .expect("bare GET must deserialize");
        assert!(input.method.is_none());
        assert!(input.headers.is_none());
        assert!(input.reveal_after_ms.is_none());
    }

    /// The page hands back exactly this shape; it must land in the same
    /// struct `source_fetch` returns so sources can swap transports.
    #[test]
    fn bridge_response_decodes_into_fetch_response() {
        let json = r#"{"status":200,"headers":{"content-type":"text/html"},"text":"<html/>"}"#;
        let resp: FetchResponse = serde_json::from_str(json).expect("bridge response");
        assert_eq!(resp.status_for_test(), 200);
        assert_eq!(resp.text_for_test(), "<html/>");
    }
}
