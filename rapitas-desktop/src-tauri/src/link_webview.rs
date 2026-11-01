//! link_webview
//!
//! A single child webview docked inside the main window, used to read a link
//! from a note or a task description without leaving rapitas.
//!
//! Why a child webview and not an iframe: sites that send `X-Frame-Options`
//! or `frame-ancestors` — GitHub, Google, most SaaS — render blank in a frame,
//! and those are exactly the links people paste into notes. The same reasoning
//! already kept iframes out of the live-preview panel.
//!
//! What this module is NOT responsible for: deciding whether a link opens here
//! or in the external browser (the frontend setting does that, see
//! `utils/tauri.ts`), and laying the pane out (the frontend owns the rectangle
//! and pushes it down through `set_link_webview_bounds`).
//!
//! NOTE: a child webview is an OS-level surface, not a DOM node. It paints
//! above all HTML in the window regardless of z-index, so the frontend hides
//! it whenever a modal or dropdown would overlap its rectangle.

use tauri::{Emitter, LogicalPosition, LogicalSize, Manager};

const MAIN_WINDOW_LABEL: &str = "main";
/// Event carrying where a docked webview went, so the tab can follow it.
const PAGE_CHANGED_EVENT: &str = "link-view://page-changed";
/// Label prefix; one webview per tab, suffixed with the tab's id.
///
/// A single webview navigated between tabs would be less code, but switching
/// would reload the page and lose scroll position — which is most of what a
/// tab is for. Only the active one is shown and positioned; the rest stay
/// built and hidden.
const LINK_WEBVIEW_PREFIX: &str = "link-view-";

/// The webview label for a tab id, rejecting ids that are not plain tokens.
///
/// The id reaches here from the webview, and a label is an identifier the
/// runtime looks things up by — so it is constrained rather than trusted.
fn label_for(tab_id: &str) -> Result<String, String> {
    if tab_id.is_empty()
        || tab_id.len() > 32
        || !tab_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid tab id".to_string());
    }
    Ok(format!("{LINK_WEBVIEW_PREFIX}{tab_id}"))
}

/// A rectangle in the main window's logical (CSS-pixel) coordinate space.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    /// Clamp to something a webview can actually be given.
    ///
    /// A zero or negative size is rejected by the platform layer, and the
    /// frontend legitimately reports one for a single frame while the pane is
    /// mounting or collapsed — hiding is how it goes away, not a 0×0 rect.
    fn sanitized(self) -> Self {
        Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
        }
    }
}

/// Where a docked webview has moved to, as reported by the webview itself.
///
/// Both fields are optional because the two reporters see different halves:
/// a navigation knows the URL, a title change knows the title and re-reads
/// the URL. The frontend keeps whichever half is missing.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PageChange {
    tab_id: String,
    url: Option<String>,
    title: Option<String>,
}

/// Whether a URL the webview moved to is worth telling the frontend about.
///
/// The address bar shows this, so an `about:blank` between two pages would
/// blank it for a frame, and the non-web schemes a page may trigger
/// (`mailto:`, an app handler) are not somewhere the tab went.
fn reportable_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Reject anything that is not a plain web URL.
///
/// Mirrors `browser::open_url_in_browser`: this command is reachable from the
/// webview, and `javascript:` / `file:` / `data:` in a view that lives inside
/// the app window would be a privilege-escalation sink rather than a link.
fn validate_url(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err("Only http(s) URLs may be opened".to_string())
    }
}

/// Tauri command: show `url` in the docked webview, creating it on first use.
///
/// Navigating an existing webview is preferred over rebuilding it so that back
/// history survives following a second link.
///
/// # Errors
/// Returns a message when the URL is not http(s), the main window is gone, or
/// the platform refuses to create the webview.
#[tauri::command]
pub async fn open_link_webview(
    app: tauri::AppHandle,
    tab_id: String,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    validate_url(&url)?;
    let label = label_for(&tab_id)?;
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    let bounds = bounds.sanitized();

    if let Some(existing) = app.get_webview(&label) {
        existing
            .navigate(parsed)
            .map_err(|e| format!("Failed to navigate link view: {e}"))?;
        apply_bounds(&existing, bounds)?;
        existing
            .show()
            .map_err(|e| format!("Failed to show link view: {e}"))?;
        return Ok(());
    }

    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or("Main window not found")?;

    // The tab has to follow the page, not just start it: a search run
    // inside the webview moves it, and nothing in the frontend can see
    // that happen (#1078).
    let nav_app = app.clone();
    let nav_tab = tab_id.clone();
    let title_app = app.clone();
    let title_tab = tab_id.clone();

    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed))
        .on_navigation(move |url| {
            let url = url.to_string();
            if reportable_url(&url) {
                let _ = nav_app.emit(
                    PAGE_CHANGED_EVENT,
                    PageChange {
                        tab_id: nav_tab.clone(),
                        url: Some(url),
                        title: None,
                    },
                );
            }
            // Report only; deciding what may load is `validate_url`'s job
            // at the entry point, and refusing here would silently break
            // navigations that already work.
            true
        })
        // A page that moves through the History API — which is how a lot
        // of search runs — fires no navigation, so the URL is re-read here
        // as well rather than only alongside the title.
        .on_document_title_changed(move |webview, title| {
            let url = webview
                .url()
                .ok()
                .map(|u| u.to_string())
                .filter(|u| reportable_url(u));
            let _ = title_app.emit(
                PAGE_CHANGED_EVENT,
                PageChange {
                    tab_id: title_tab.clone(),
                    url,
                    title: Some(title),
                },
            );
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| format!("Failed to create link view: {e}"))?;

    Ok(())
}

/// Move and resize the docked webview to match the pane's rectangle.
///
/// Called on every layout change the frontend observes; a missing webview is
/// not an error because the pane can be resized in the same frame it closes.
///
/// # Errors
/// Returns a message when the platform refuses the new geometry.
#[tauri::command]
pub async fn set_link_webview_bounds(
    app: tauri::AppHandle,
    tab_id: String,
    bounds: Bounds,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&label_for(&tab_id)?) else {
        return Ok(());
    };
    apply_bounds(&webview, bounds.sanitized())
}

/// Show or hide the docked webview without destroying it.
///
/// Hiding is what the frontend does when a modal would be covered by the
/// webview's own surface, and when the pane scrolls out of view.
///
/// # Errors
/// Returns a message when the platform refuses the visibility change.
#[tauri::command]
pub async fn set_link_webview_visible(
    app: tauri::AppHandle,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&label_for(&tab_id)?) else {
        return Ok(());
    };
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|e| format!("Failed to change link view visibility: {e}"))
}

/// Close the docked webview.
///
/// # Errors
/// Returns a message when the platform refuses to close it.
#[tauri::command]
pub async fn close_link_webview(app: tauri::AppHandle, tab_id: String) -> Result<(), String> {
    let Some(webview) = app.get_webview(&label_for(&tab_id)?) else {
        return Ok(());
    };
    webview
        .close()
        .map_err(|e| format!("Failed to close link view: {e}"))
}

/// Navigate the docked webview's history, or reload it.
///
/// `action` is `back`, `forward` or `reload`. History is moved through
/// `eval` because tauri exposes no history API on `Webview`; the script runs
/// in the remote page, which is exactly where its history lives.
///
/// # Errors
/// Returns a message for an unknown action or when the webview rejects it.
#[tauri::command]
pub async fn link_webview_history(
    app: tauri::AppHandle,
    tab_id: String,
    action: String,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&label_for(&tab_id)?) else {
        return Ok(());
    };
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        other => return Err(format!("Unknown history action: {other}")),
    };
    webview
        .eval(script)
        .map_err(|e| format!("Failed to run history action: {e}"))
}

/// Apply a sanitized rectangle to a webview.
fn apply_bounds(webview: &tauri::Webview, bounds: Bounds) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| format!("Failed to position link view: {e}"))?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| format!("Failed to resize link view: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        // The view lives inside the app window, so these are escalation sinks.
        for url in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/drivers/etc/hosts",
            "data:text/html,<script>alert(1)</script>",
            "tauri://localhost",
            "",
        ] {
            assert!(validate_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn accepts_web_urls() {
        for url in [
            "http://example.com",
            "https://github.com/owner/repo/issues/1",
        ] {
            assert!(validate_url(url).is_ok(), "{url} should be accepted");
        }
    }

    #[test]
    fn sanitizes_degenerate_rectangles() {
        // The pane reports 0x0 for a frame while mounting; a webview cannot be
        // given that, and hiding — not a zero rect — is how it disappears.
        let b = Bounds {
            x: -10.0,
            y: -1.0,
            width: 0.0,
            height: -5.0,
        }
        .sanitized();
        assert_eq!((b.x, b.y), (0.0, 0.0));
        assert!(b.width >= 1.0 && b.height >= 1.0);
    }

    #[test]
    fn builds_a_label_per_tab() {
        assert_eq!(label_for("t1").unwrap(), "link-view-t1");
        assert_ne!(label_for("t1").unwrap(), label_for("t2").unwrap());
    }

    #[test]
    fn rejects_tab_ids_that_are_not_plain_tokens() {
        // The id arrives from the webview and becomes a runtime lookup key.
        let too_long = "x".repeat(33);
        for id in ["", "a b", "../x", "t1\n", "t1/../t2", too_long.as_str()] {
            assert!(label_for(id).is_err(), "{id:?} should be rejected");
        }
    }

    #[test]
    fn reports_only_web_pages_to_the_tab() {
        // The address bar shows whatever is reported, so a blank page
        // between two real ones, or a scheme the page merely handed to the
        // OS, must not overwrite where the tab actually is.
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
    fn keeps_valid_rectangles_unchanged() {
        let b = Bounds {
            x: 320.0,
            y: 48.0,
            width: 600.0,
            height: 800.0,
        }
        .sanitized();
        assert_eq!((b.x, b.y, b.width, b.height), (320.0, 48.0, 600.0, 800.0));
    }
}
