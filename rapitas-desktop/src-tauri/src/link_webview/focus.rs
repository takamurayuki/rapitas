//! link_webview::focus
//!
//! Hands keyboard focus back to the app's own webview when an in-app browser
//! webview is hidden. Not responsible for deciding when a webview is hidden
//! (`apply_visible` is the only caller).
//!
//! NOTE: wry's `set_visible(false)` on Windows only hides the window
//! (`ShowWindow(SW_HIDE)` + `SetIsVisible(false)`) and leaves Win32 focus on
//! it. When the page had focus — the user clicked into it, then opened the
//! side nav, a dropdown or a dialog — every keystroke went to the hidden page
//! and the app looked frozen until a click moved focus back.

use tauri::Manager;

use super::MAIN_WINDOW_LABEL;

/// Whether a visibility change should move focus back to the app's webview.
///
/// Only a hide does: a show leaves focus where the user put it. And only while
/// the main window is the active one, so a hide caused by background work never
/// pulls the user out of another app.
///
/// # Arguments
/// * `visible` - The visibility just applied / 適用した表示状態
/// * `main_window_focused` - Whether the main window is active / メインウィンドウがアクティブか
pub(super) fn should_reclaim(visible: bool, main_window_focused: bool) -> bool {
    !visible && main_window_focused
}

/// Move focus to the main webview after `webview` was hidden.
///
/// Best effort: a missing window or a refused focus change leaves things as
/// they were, which is no worse than before this existed.
///
/// # Arguments
/// * `webview` - The link view that was just hidden / 非表示にした webview
pub(super) fn reclaim_after_hide(webview: &tauri::Webview) {
    let app = webview.app_handle();
    let Some(window) = app.get_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if !should_reclaim(false, window.is_focused().unwrap_or(false)) {
        return;
    }
    if let Some(main) = app.get_webview(MAIN_WINDOW_LABEL) {
        let _ = main.set_focus();
    }
}
