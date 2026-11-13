//! link_webview
//!
//! Child webviews docked inside the main window — one per in-app browser
//! tab — used by both the side pane and the full `/browser` screen.
//!
//! Why a child webview and not an iframe: sites that send `X-Frame-Options`
//! or `frame-ancestors` — GitHub, Google, most SaaS — render blank in a frame,
//! and those are exactly the links people paste into notes.
//!
//! What this module is NOT responsible for: deciding whether a link opens here
//! or in the external browser (the frontend setting does that), laying the
//! pane out (the frontend owns the rectangle and pushes it through
//! `set_link_webview_bounds`), or deciding visibility (the frontend's
//! `applyVisibility` does, and only `set_link_webview_visible` applies it;
//! the forced hides on creation and on clearing go through the same
//! `apply_visible` under the same lock).
//!
//! NOTE: a child webview is an OS-level surface, not a DOM node. It paints
//! above all HTML in the window regardless of z-index, so the frontend hides
//! it whenever a side nav, dropdown or dialog would overlap its rectangle.

mod builder;
mod burst;
pub mod policy;
mod visibility;

use std::sync::Mutex;

use tauri::{LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize};

use visibility::SequenceTable;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
/// Label prefix; one webview per tab, suffixed with the tab's id.
///
/// One webview per tab rather than one navigated between them: switching
/// would otherwise reload the page and lose scroll position.
pub const LINK_WEBVIEW_PREFIX: &str = "link-view-";
/// The throwaway webview `clear_link_view_data` uses when no tab is open.
const CLEAR_DATA_LABEL: &str = "link-view--clear-data";

/// Shared state: the show/hide sequence table. Its lock is also held while a
/// webview is created and hidden, so no visibility command can land between.
#[derive(Default)]
pub struct LinkViewState {
    sequences: Mutex<SequenceTable>,
}

/// Whether an IPC call comes from an in-app browser webview.
///
/// Those hold remote pages. `app_setup` rejects every app command from them
/// before dispatch — a second wall behind the capability scoping, in case a
/// local document ever ended up inside one (nav60 §5.2-3).
pub fn is_link_view_label(label: &str) -> bool {
    label.starts_with(LINK_WEBVIEW_PREFIX)
}

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

/// Parse and check a URL for the in-app browser.
///
/// Mirrors `browser::open_url_in_browser` for the scheme, and additionally
/// refuses the app's own and the backend's origins (`policy`).
fn validate_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    policy::check(&builder::parts_of(&parsed))
        .map_err(|_| "This address cannot be opened in the in-app browser".to_string())?;
    Ok(parsed)
}

/// Tauri command: point a tab's webview at `url`, creating it on first use.
///
/// Never changes visibility: an existing webview keeps whatever state it had
/// (hidden stays hidden while it loads), and a new one is created hidden.
/// The frontend's `applyVisibility` shows it afterwards through
/// `set_link_webview_visible`.
///
/// # Errors
/// Returns a message when the URL is refused, the main window is gone, or
/// the platform refuses to create the webview.
#[tauri::command]
pub async fn open_link_webview(
    app: tauri::AppHandle,
    state: tauri::State<'_, LinkViewState>,
    tab_id: String,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let parsed = validate_url(&url)?;
    let label = label_for(&tab_id)?;
    let bounds = bounds.sanitized();

    if let Some(existing) = app.get_webview(&label) {
        existing
            .navigate(parsed)
            .map_err(|e| format!("Failed to navigate link view: {e}"))?;
        // NOTE: The `.show()` that used to follow is gone on purpose — it
        // made the page appear before (and regardless of) the frontend's
        // visibility decision, e.g. under an open dialog (nav60 §3.1).
        return apply_bounds(&existing, bounds);
    }

    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or("Main window not found")?;
    let builder = builder::build(&app, &label, &tab_id, parsed)?;

    // Created off-screen at 1×1 and hidden before the lock is released: a
    // child webview starts visible (tauri has no "create hidden" option), and
    // `Bounds::sanitized` clamps negatives to 0, so the off-screen spot is
    // computed here from the window's own size.
    let sequences = lock_sequences(&state)?;
    let size = window
        .inner_size()
        .map_err(|e| format!("Failed to read window size: {e}"))?;
    let offscreen = PhysicalPosition::new(size.width as i32 + 64, size.height as i32 + 64);
    let webview = window
        .add_child(builder, offscreen, PhysicalSize::new(1u32, 1u32))
        .map_err(|e| format!("Failed to create link view: {e}"))?;
    apply_visible(&sequences, &webview, false)
        .map_err(|e| format!("Failed to hide new link view: {e}"))?;
    let placed = apply_bounds(&webview, bounds);
    drop(sequences);
    placed
}

/// Move and resize the docked webview to match the pane's rectangle.
///
/// Called on every layout change the frontend observes; a missing webview is
/// not an error because the pane can be resized in the same frame it closes.
/// Does not change visibility.
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

/// Show or hide a tab's webview — the ONLY command that changes visibility.
///
/// `seq` comes from the frontend's single `applyVisibility` and grows across
/// all tabs. A command no newer than the last one applied to this webview is
/// dropped, so a late, stale "show" can never undo a newer "hide". The check
/// and the show/hide happen under one lock, in sequence order.
///
/// # Errors
/// Returns a message when the platform refuses the visibility change.
#[tauri::command]
pub async fn set_link_webview_visible(
    app: tauri::AppHandle,
    state: tauri::State<'_, LinkViewState>,
    tab_id: String,
    visible: bool,
    seq: u64,
) -> Result<(), String> {
    let label = label_for(&tab_id)?;
    let mut sequences = lock_sequences(&state)?;
    if !sequences.admit(&label, seq) {
        return Ok(());
    }
    // No webview yet: the seq is recorded (above) and nothing is shown.
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    apply_visible(&sequences, &webview, visible)
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
/// `eval` because tauri exposes no history API on `Webview`. These three
/// fixed scripts are the only code the app ever runs in a page (nav60 §5.1).
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

/// Tauri command: clear the in-app browser's cookies, storage and cache.
///
/// Only the link views' own data store is touched (it is separate from the
/// main webview's, see `builder::with_link_view_store`), so the app's sign-in
/// survives. Every link view is closed afterwards — clearing is
/// asynchronous in the engines — and the frontend reloads tabs on next show.
///
/// # Errors
/// Returns a message when the engine refuses to clear or a webview cannot be
/// created for the purpose.
#[tauri::command]
pub async fn clear_link_view_data(
    app: tauri::AppHandle,
    state: tauri::State<'_, LinkViewState>,
) -> Result<(), String> {
    let views: Vec<tauri::Webview> = app
        .webviews()
        .into_iter()
        .filter(|(label, _)| is_link_view_label(label))
        .map(|(_, webview)| webview)
        .collect();

    if let Some(first) = views.first() {
        first
            .clear_all_browsing_data()
            .map_err(|e| format!("Failed to clear browsing data: {e}"))?;
    } else {
        let window = app
            .get_window(MAIN_WINDOW_LABEL)
            .ok_or("Main window not found")?;
        let blank: tauri::Url = "about:blank".parse().map_err(|e| format!("{e}"))?;
        let builder = builder::with_link_view_store(
            tauri::webview::WebviewBuilder::new(
                CLEAR_DATA_LABEL,
                tauri::WebviewUrl::External(blank),
            ),
            &app,
        )?;
        let size = window
            .inner_size()
            .map_err(|e| format!("Failed to read window size: {e}"))?;
        let sequences = lock_sequences(&state)?;
        let temp = window
            .add_child(
                builder,
                PhysicalPosition::new(size.width as i32 + 64, size.height as i32 + 64),
                PhysicalSize::new(1u32, 1u32),
            )
            .map_err(|e| format!("Failed to create link view: {e}"))?;
        let _ = apply_visible(&sequences, &temp, false);
        drop(sequences);
        let cleared = temp
            .clear_all_browsing_data()
            .map_err(|e| format!("Failed to clear browsing data: {e}"));
        let _ = temp.close();
        cleared?;
    }

    // NOTE: Hidden and closed under the sequence lock, through the same
    // `apply_visible` as every other show/hide, so a "show" already in flight
    // cannot land between the hide and the close and flash a dying page.
    let sequences = lock_sequences(&state)?;
    for webview in views {
        let _ = apply_visible(&sequences, &webview, false);
        let _ = webview.close();
    }
    drop(sequences);
    Ok(())
}

/// Lock the show/hide sequence table.
fn lock_sequences<'a>(
    state: &'a LinkViewState,
) -> Result<std::sync::MutexGuard<'a, SequenceTable>, String> {
    state
        .sequences
        .lock()
        .map_err(|_| "Link view state poisoned".to_string())
}

/// Show or hide a webview — the one place `show()`/`hide()` is called.
///
/// Taking the locked table is the proof the caller holds the sequence lock,
/// so no ordered visibility command can interleave with this one.
///
/// # Arguments
/// * `_held` - The locked sequence table / ロック済みの連番表
/// * `webview` - The webview to change / 対象の webview
/// * `visible` - Show when true, hide when false / 表示するなら true
///
/// # Errors
/// Returns the platform's error when it refuses the change.
fn apply_visible(
    _held: &SequenceTable,
    webview: &tauri::Webview,
    visible: bool,
) -> tauri::Result<()> {
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
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
mod tests;
