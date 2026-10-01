//! The update check's one network request, made from Rust.
//!
//! It used to be a `fetch()` from the webview, and that never worked: GitHub's
//! release-asset download (`/releases/latest/download/latest.json` → two 302s
//! → `release-assets.githubusercontent.com`) sends no
//! `Access-Control-Allow-Origin` on any hop, so the webview blocked every
//! response, the frontend caught the error, and "could not check" looked
//! exactly like "up to date". No shipped build ever offered an update. Rust is
//! not subject to CORS, so the request lives here — on every platform,
//! Android included, which is why nothing in this file is `#[cfg(desktop)]`.
//!
//! The privacy promise in `src/store/updates.ts` holds for this request too:
//! one unauthenticated GET, no identifiers. That is why it does NOT reuse the
//! scraper client in `sources.rs` — that one carries a process-wide cookie jar
//! and a borrowed Chrome User-Agent, both right for scraping and wrong here.

use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;

/// A manifest bigger than this is not ours. The real one is ~6 KB; a captive
/// portal or an error page is the thing this guards against.
const MAX_MANIFEST_BYTES: usize = 64 * 1024;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, PartialEq, Serialize)]
pub struct Manifest {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// The manifest URL, read from `plugins.updater.endpoints` in tauri.conf.json.
///
/// One source of truth: the updater plugin installs from that same endpoint,
/// so the check and the install can never disagree about where releases are.
/// It also means a test build pointed at a local server with `--config`
/// redirects both at once.
fn endpoint_from_config(plugins: &serde_json::Value) -> Option<String> {
    plugins
        .get("updater")?
        .get("endpoints")?
        .as_array()?
        .first()?
        .as_str()
        .map(str::to_owned)
}

fn parse_manifest(body: &[u8]) -> Result<Manifest, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "manifest is not JSON".to_string())?;
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "manifest has no version".to_string())?;
    let notes = value
        .get("notes")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    Ok(Manifest {
        version: version.to_owned(),
        notes,
    })
}

/// Append a chunk, refusing to grow past the cap.
fn push_capped(buf: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if buf.len() + chunk.len() > MAX_MANIFEST_BYTES {
        return Err("manifest is too large".into());
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

/// GET the release manifest and return its version and notes.
///
/// Errors are plain strings: the frontend only needs to know that the check
/// failed, so it can say "couldn't check" instead of pretending all is well.
#[tauri::command]
pub async fn check_update_manifest(app: AppHandle) -> Result<Manifest, String> {
    let plugins = serde_json::to_value(&app.config().plugins.0).unwrap_or_default();
    let url = endpoint_from_config(&plugins)
        .ok_or_else(|| "no updater endpoint configured".to_string())?;
    fetch_manifest(&url, &app.package_info().version.to_string()).await
}

async fn fetch_manifest(url: &str, app_version: &str) -> Result<Manifest, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("Riwaq/{app_version}"))
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("manifest request failed: HTTP {}", resp.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        push_capped(&mut body, &chunk)?;
    }
    parse_manifest(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_first_updater_endpoint() {
        let plugins = json!({ "updater": { "pubkey": "k", "endpoints": ["https://a/latest.json", "https://b"] } });
        assert_eq!(
            endpoint_from_config(&plugins).as_deref(),
            Some("https://a/latest.json")
        );
    }

    #[test]
    fn no_endpoint_when_the_updater_block_is_missing_or_empty() {
        assert_eq!(endpoint_from_config(&json!({})), None);
        assert_eq!(
            endpoint_from_config(&json!({ "updater": { "endpoints": [] } })),
            None
        );
    }

    #[test]
    fn the_shipped_config_has_an_endpoint() {
        // The command is useless without one, and nothing else would notice it
        // going missing: the check would just fail quietly on every launch.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let url = endpoint_from_config(&conf["plugins"]).expect("updater endpoint");
        assert!(
            url.ends_with("/releases/latest/download/latest.json"),
            "{url}"
        );
    }

    #[test]
    fn parses_version_and_notes() {
        let body = br#"{"version":"0.6.0","notes":"Faster","platforms":{}}"#;
        assert_eq!(
            parse_manifest(body),
            Ok(Manifest {
                version: "0.6.0".into(),
                notes: Some("Faster".into())
            })
        );
    }

    #[test]
    fn notes_are_optional() {
        assert_eq!(
            parse_manifest(br#"{"version":"0.6.0"}"#).unwrap().notes,
            None
        );
    }

    #[test]
    fn rejects_html_and_versionless_manifests() {
        // A captive portal serves HTML with a 200.
        assert!(parse_manifest(b"<!DOCTYPE html>").is_err());
        assert!(parse_manifest(br#"{"platforms":{}}"#).is_err());
        assert!(parse_manifest(br#"{"version":""}"#).is_err());
        assert!(parse_manifest(br#"{"version":3}"#).is_err());
    }

    #[test]
    fn caps_the_body() {
        let mut buf = Vec::new();
        push_capped(&mut buf, &vec![b'x'; MAX_MANIFEST_BYTES]).unwrap();
        assert!(push_capped(&mut buf, b"x").is_err());
        assert_eq!(buf.len(), MAX_MANIFEST_BYTES);
    }

    /// Hits the real GitHub endpoint, so it is opt-in:
    /// `cargo test --lib updates -- --ignored`. It is the check that would
    /// have caught the CORS bug — run it after touching the release URL or
    /// this client.
    #[test]
    #[ignore = "network"]
    fn live_github_manifest() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let url = endpoint_from_config(&conf["plugins"]).unwrap();
        let m = tauri::async_runtime::block_on(fetch_manifest(&url, "0.0.0")).unwrap();
        assert!(m.version.split('.').count() == 3, "{m:?}");
    }
}
