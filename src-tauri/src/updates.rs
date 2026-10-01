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
    let body = get_capped(&client(app_version)?, url, MAX_MANIFEST_BYTES).await?;
    parse_manifest(&body)
}

const APK_ASSET: &str = "app-universal-release.apk";
const NOTES_ASSET: &str = "whats-new.json";
const SUMS_ASSET: &str = "SHA256SUMS";
const MAX_IMAGE_BYTES: usize = 150 * 1024;

/// Where one release's assets live. Versioned, never `/latest/`: a release
/// published while the sheet is open must not swap the notes or the APK
/// out from under the checksum we already fetched.
fn release_base(endpoint: &str, version: &str) -> Option<String> {
    const LATEST: &str = "/releases/latest/download/latest.json";
    if let Some(repo) = endpoint.strip_suffix(LATEST) {
        return Some(format!("{repo}/releases/download/v{version}/"));
    }
    let cut = endpoint.rfind('/')?;
    let base = endpoint[..=cut].to_string();
    // Never an unversioned base: an odd GitHub URL must fail, not fall back.
    (!base.contains("/releases/latest/")).then_some(base)
}

/// Whether appending `add` bytes to `have` stays within `cap`.
fn within_cap(have: usize, add: usize, cap: usize) -> bool {
    have + add <= cap
}

fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn valid_image_name(n: &str) -> bool {
    n.ends_with(".webp")
        && !n.starts_with('.')
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn checksum_for(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut it = line.split_whitespace();
        let hash = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn client(app_version: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Riwaq/{app_version}"))
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

async fn get_capped(client: &reqwest::Client, url: &str, cap: usize) -> Result<Vec<u8>, String> {
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if !within_cap(body.len(), chunk.len(), cap) {
            return Err(format!("{url}: larger than {cap} bytes"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn configured_endpoint(app: &AppHandle) -> Result<String, String> {
    let plugins = serde_json::to_value(&app.config().plugins.0).unwrap_or_default();
    endpoint_from_config(&plugins).ok_or_else(|| "no updater endpoint configured".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesPayload {
    notes: serde_json::Value,
    highlight_image: Option<String>,
}

#[tauri::command]
pub async fn fetch_release_notes(
    app: AppHandle,
    version: String,
) -> Result<ReleaseNotesPayload, String> {
    if !valid_version(&version) {
        return Err("bad version".into());
    }
    let base = release_base(&configured_endpoint(&app)?, &version).ok_or("bad endpoint")?;
    let c = client(&app.package_info().version.to_string())?;
    let raw = get_capped(&c, &format!("{base}{NOTES_ASSET}"), MAX_MANIFEST_BYTES).await?;
    let notes: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|_| "notes are not JSON")?;
    // The image is optional decoration: any failure here drops the image,
    // never the notes.
    let mut highlight_image = None;
    if let Some(name) = notes.pointer("/highlight/image").and_then(|v| v.as_str()) {
        if valid_image_name(name) {
            if let Ok(bytes) = get_capped(&c, &format!("{base}{name}"), MAX_IMAGE_BYTES).await {
                use base64::Engine;
                highlight_image = Some(format!(
                    "data:image/webp;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ));
            }
        }
    }
    Ok(ReleaseNotesPayload {
        notes,
        highlight_image,
    })
}

#[derive(Debug, Serialize)]
pub struct ApkDetails {
    url: String,
    sha256: String,
    size: u64,
}

async fn apk_details(
    endpoint: &str,
    version: &str,
    app_version: &str,
) -> Result<ApkDetails, String> {
    let base = release_base(endpoint, version).ok_or("bad endpoint")?;
    let c = client(app_version)?;
    let sums = get_capped(&c, &format!("{base}{SUMS_ASSET}"), MAX_MANIFEST_BYTES).await?;
    // No checksum, no install: an APK we cannot verify is never offered.
    let sha256 = checksum_for(&String::from_utf8_lossy(&sums), APK_ASSET)
        .ok_or("SHA256SUMS has no line for the APK")?;
    let url = format!("{base}{APK_ASSET}");
    let head = c.head(&url).send().await.map_err(|e| e.to_string())?;
    if !head.status().is_success() {
        return Err(format!("{url}: HTTP {}", head.status()));
    }
    // Read the header itself: reqwest's content_length() describes the body
    // it received, which for a HEAD is empty.
    let size = head
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("no Content-Length for the APK")?;
    Ok(ApkDetails { url, sha256, size })
}

#[tauri::command]
pub async fn fetch_apk_details(app: AppHandle, version: String) -> Result<ApkDetails, String> {
    if !valid_version(&version) {
        return Err("bad version".into());
    }
    apk_details(
        &configured_endpoint(&app)?,
        &version,
        &app.package_info().version.to_string(),
    )
    .await
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
    fn release_base_for_github_and_for_a_test_server() {
        assert_eq!(
            release_base(
                "https://github.com/o/r/releases/latest/download/latest.json",
                "0.6.0"
            )
            .as_deref(),
            Some("https://github.com/o/r/releases/download/v0.6.0/")
        );
        // An e2e build points at a local server: assets sit beside latest.json.
        assert_eq!(
            release_base("http://127.0.0.1:8765/latest.json", "0.6.0").as_deref(),
            Some("http://127.0.0.1:8765/")
        );
    }

    #[test]
    fn release_base_never_falls_back_to_latest() {
        for ep in [
            "https://github.com/o/r/releases/latest/download/latest.json?x=1",
            "https://github.com/o/r/releases/latest/download/latest.json/",
        ] {
            assert_eq!(release_base(ep, "0.6.0"), None, "{ep}");
        }
    }

    #[test]
    fn size_cap_is_inclusive() {
        assert!(within_cap(0, 10, 10));
        assert!(within_cap(4, 6, 10));
        assert!(!within_cap(4, 7, 10));
        assert!(!within_cap(10, 1, 10));
    }

    #[test]
    fn version_must_be_plain_semver() {
        // It is spliced into a URL; nothing but digits and dots gets in.
        assert!(valid_version("0.6.10"));
        assert!(!valid_version("0.6.0/../../x"));
        assert!(!valid_version("0.6"));
        assert!(!valid_version(""));
    }

    #[test]
    fn checksum_for_finds_the_apk_line_only() {
        let sums = "aa  other.exe\nF973A8BBF8BEE7D0CED32E47107418A37AC9CD9A9C6DBAD2446740E84C1E0673 *app-universal-release.apk\n";
        assert_eq!(
            checksum_for(sums, "app-universal-release.apk").as_deref(),
            Some("f973a8bbf8bee7d0ced32e47107418a37ac9cd9a9c6dbad2446740e84c1e0673")
        );
        assert_eq!(checksum_for(sums, "missing.apk"), None);
        // A truncated hash must not pass as a checksum.
        assert_eq!(
            checksum_for(
                "abc  app-universal-release.apk",
                "app-universal-release.apk"
            ),
            None
        );
    }

    #[test]
    fn image_names_are_bare_webp_files() {
        assert!(valid_image_name("0.6.0-cards.webp"));
        assert!(!valid_image_name("../secret.webp"));
        assert!(!valid_image_name("x.png"));
    }

    #[test]
    #[ignore = "network"]
    fn live_checksum_for_a_published_release() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let ep = endpoint_from_config(&conf["plugins"]).unwrap();
        let d = tauri::async_runtime::block_on(apk_details(&ep, "0.5.1", "0.0.0")).unwrap();
        assert_eq!(d.sha256.len(), 64);
        assert!(d.size > 1_000_000, "{d:?}");
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
