//! link_webview::builder
//!
//! Builds one docked webview with every boundary the in-app browser needs
//! (nav60 §5.2–§5.4.3): main-frame navigation filtered by `policy`,
//! `window.open` denied and handed to the frontend as a new tab (rate
//! limited), downloads and every permission request refused, load progress
//! reported, and a data store kept apart from the main webview's.
//!
//! Not responsible for showing it — creation always ends hidden, and only
//! `set_link_webview_visible` shows (see `mod.rs`).

use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::webview::{
    DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder,
};
use tauri::{Emitter, Url, Wry};

use super::burst::BurstLimiter;
use super::policy::{self, Refusal, UrlParts};
use super::MAIN_WINDOW_LABEL;

/// Where a tab went (URL and/or title) — drives the tab and the address bar.
pub const PAGE_CHANGED_EVENT: &str = "link-view://page-changed";
/// Load started / finished, for the progress bar and the slow-load band.
pub const LOAD_STATE_EVENT: &str = "link-view://load-state";
/// A main-frame navigation the policy stopped.
pub const NAVIGATION_BLOCKED_EVENT: &str = "link-view://navigation-blocked";
/// A `window.open` / `target=_blank` the frontend should open as a tab.
pub const NEW_WINDOW_EVENT: &str = "link-view://new-window-requested";
/// A `window.open` that was dropped (refused URL, blank, or over the limit).
pub const NEW_WINDOW_BLOCKED_EVENT: &str = "link-view://new-window-blocked";
/// A download that was refused.
pub const DOWNLOAD_BLOCKED_EVENT: &str = "link-view://download-blocked";

/// The macOS ≥ 14 data store shared by every `link-view-*` webview.
///
/// Fixed so tabs share one cookie jar (a sign-in carries across tabs) and so
/// it survives restarts; distinct from the main webview's default store.
#[cfg(target_os = "macos")]
const LINK_VIEW_DATA_STORE_ID: [u8; 16] = *b"rapitas-linkview";

/// Directory (under the app's local data dir) for the Windows / Linux store.
#[cfg(not(target_os = "macos"))]
const LINK_VIEW_DATA_DIR: &str = "link-view";

/// A page change, as sent to the frontend.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageChange {
    pub tab_id: String,
    pub url: Option<String>,
    pub title: Option<String>,
}

/// Payload for the load / blocked / new-window events.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabEvent {
    pub tab_id: String,
    /// The URL concerned (target of a refusal, the download, the new tab).
    pub url: String,
    /// `started` / `finished` for load state; the refusal kind otherwise.
    pub detail: String,
}

/// Whether a URL the webview moved to is worth showing in the address bar.
pub fn reportable_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// The policy's view of a parsed URL.
pub fn parts_of(url: &Url) -> UrlParts<'_> {
    UrlParts {
        scheme: url.scheme(),
        host: url.host_str().unwrap_or(""),
        port: url.port(),
    }
}

fn refusal_name(r: Refusal) -> &'static str {
    match r {
        Refusal::Scheme => "scheme",
        Refusal::AppOrigin => "app-origin",
    }
}

/// Emit to the main window only. Child webviews hold remote pages and must
/// not receive the app's events (they also lack the capability to listen).
fn emit_main<S: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, event, payload);
}

/// Point a builder at the in-app browser's own data store.
///
/// Windows / Linux: a separate data directory (a separate WebView2 user data
/// folder / WebKit context). macOS 14+: a fixed data store identifier.
/// macOS 13 and older have neither, so the store is non-persistent there —
/// site sign-ins last until the app quits (nav60 §5.4.3).
///
/// # Errors
/// Returns a message when the app's local data directory cannot be resolved.
pub fn with_link_view_store(
    builder: WebviewBuilder<Wry>,
    app: &tauri::AppHandle,
) -> Result<WebviewBuilder<Wry>, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        if macos_major_version().is_some_and(|v| v >= 14) {
            Ok(builder.data_store_identifier(LINK_VIEW_DATA_STORE_ID))
        } else {
            Ok(builder.incognito(true))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("No local data dir for the link view: {e}"))?
            .join(LINK_VIEW_DATA_DIR);
        Ok(builder.data_directory(dir))
    }
}

/// The running macOS major version, read once from `sw_vers`.
#[cfg(target_os = "macos")]
fn macos_major_version() -> Option<u32> {
    use std::sync::OnceLock;
    static VERSION: OnceLock<Option<u32>> = OnceLock::new();
    *VERSION.get_or_init(|| {
        let out = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .split('.')
            .next()?
            .parse()
            .ok()
    })
}

/// Build the webview for one tab, with every handler attached.
///
/// # Arguments
/// * `app` - The app handle the handlers emit through / イベント送出用
/// * `label` - The webview label (`link-view-<tabId>`) / webview ラベル
/// * `tab_id` - The tab the events are about / タブ ID
/// * `url` - The first page, already checked by `policy` / 最初の URL
///
/// # Errors
/// Returns a message when the data store cannot be configured.
pub fn build(
    app: &tauri::AppHandle,
    label: &str,
    tab_id: &str,
    url: Url,
) -> Result<WebviewBuilder<Wry>, String> {
    let nav = (app.clone(), tab_id.to_string());
    let title = (app.clone(), tab_id.to_string());
    let load = (app.clone(), tab_id.to_string());
    let popup = (app.clone(), tab_id.to_string());
    let download = (app.clone(), tab_id.to_string());
    let limiter = Arc::new(Mutex::new(BurstLimiter::default()));

    // NOTE: tauri defaults to `focus: true`, which moved keyboard focus into
    // this webview while it was still hidden off-screen at 1x1. The user
    // gives the page focus by clicking it (see `focus.rs`).
    let builder = WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
        .focused(false)
        .on_navigation(move |url| {
            let (app, tab_id) = &nav;
            if let Err(refusal) = policy::check_navigation(&parts_of(url)) {
                emit_main(
                    app,
                    NAVIGATION_BLOCKED_EVENT,
                    TabEvent {
                        tab_id: tab_id.clone(),
                        url: url.to_string(),
                        detail: refusal_name(refusal).to_string(),
                    },
                );
                return false;
            }
            let url = url.to_string();
            if reportable_url(&url) {
                emit_main(
                    app,
                    PAGE_CHANGED_EVENT,
                    PageChange {
                        tab_id: tab_id.clone(),
                        url: Some(url),
                        title: None,
                    },
                );
            }
            true
        })
        // A page that moves through the History API fires no navigation, so
        // the URL is re-read alongside the title.
        .on_document_title_changed(move |webview, page_title| {
            let (app, tab_id) = &title;
            let url = webview
                .url()
                .ok()
                .map(|u| u.to_string())
                .filter(|u| reportable_url(u));
            emit_main(
                app,
                PAGE_CHANGED_EVENT,
                PageChange {
                    tab_id: tab_id.clone(),
                    url,
                    title: Some(page_title),
                },
            );
        })
        .on_page_load(move |_webview, payload| {
            let (app, tab_id) = &load;
            let detail = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            emit_main(
                app,
                LOAD_STATE_EVENT,
                TabEvent {
                    tab_id: tab_id.clone(),
                    url: payload.url().to_string(),
                    detail: detail.to_string(),
                },
            );
        })
        // Never a new OS window. A checked http(s) target becomes a new tab
        // (a separate webview, so there is no `window.opener`); a blank or
        // refused target, or one over the burst limit, is dropped.
        .on_new_window(move |url, _features| {
            let (app, tab_id) = &popup;
            let target = url.to_string();
            let refused = if url.scheme() == "about" || target.is_empty() {
                Some("blank")
            } else if let Err(refusal) = policy::check(&parts_of(&url)) {
                Some(refusal_name(refusal))
            } else if !limiter
                .lock()
                .map(|mut l| l.try_accept(Instant::now()))
                .unwrap_or(false)
            {
                Some("rate-limit")
            } else {
                None
            };
            let (event, detail) = match refused {
                Some(why) => (NEW_WINDOW_BLOCKED_EVENT, why),
                None => (NEW_WINDOW_EVENT, "tab"),
            };
            emit_main(
                app,
                event,
                TabEvent {
                    tab_id: tab_id.clone(),
                    url: target,
                    detail: detail.to_string(),
                },
            );
            NewWindowResponse::Deny
        })
        // Q7: no downloads in the in-app browser; the band offers the
        // external browser instead.
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, .. } => {
                let (app, tab_id) = &download;
                emit_main(
                    app,
                    DOWNLOAD_BLOCKED_EVENT,
                    TabEvent {
                        tab_id: tab_id.clone(),
                        url: url.to_string(),
                        detail: "download".to_string(),
                    },
                );
                false
            }
            _ => false,
        })
        // Every kind, known or not (`PermissionKind` is non_exhaustive), is
        // denied outright. `Default` would defer to the engine/OS prompt.
        .on_permission_request(|_webview, _kind| PermissionResponse::Deny);

    with_link_view_store(builder, app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_only_web_pages_to_the_tab() {
        for url in ["https://www.google.com/search?q=rust", "http://example.com"] {
            assert!(reportable_url(url), "{url} should be reported");
        }
        for url in ["about:blank", "mailto:a@b.c", "tauri://localhost", ""] {
            assert!(!reportable_url(url), "{url} should not be reported");
        }
    }

    #[test]
    fn serializes_a_page_change_for_the_frontend() {
        // The frontend reads tabId/url/title; snake_case would arrive as
        // undefined and the tab would never move.
        let json = serde_json::to_string(&PageChange {
            tab_id: "t1".to_string(),
            url: Some("https://example.com/".to_string()),
            title: None,
        })
        .unwrap();
        assert!(json.contains("\"tabId\":\"t1\""), "{json}");
        assert!(json.contains("\"url\":\"https://example.com/\""), "{json}");
        assert!(json.contains("\"title\":null"), "{json}");
    }

    #[test]
    fn parts_of_uses_the_whatwg_normalised_host() {
        // `127.1` is 127.0.0.1 to every browser; the policy must see that.
        let url: Url = "http://127.1:3001/x".parse().unwrap();
        let p = parts_of(&url);
        assert_eq!(
            (p.scheme, p.host, p.port),
            ("http", "127.0.0.1", Some(3001))
        );
        assert!(policy::check(&p).is_err());
    }
}
