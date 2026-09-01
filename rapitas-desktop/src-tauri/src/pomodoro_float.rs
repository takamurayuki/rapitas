//! pomodoro_float
//!
//! Always-on-top, frameless, draggable floating window that mirrors the
//! Pomodoro timer outside the main window. Modeled on quick_capture's
//! show-or-build pattern; unlike quick_capture this window is toggled
//! (shown/hidden) rather than only ever shown.

use tauri::{Emitter, Manager};

const WINDOW_LABEL: &str = "pomodoro-float";

/// Toggle the Pomodoro floating window's visibility, creating it on first use.
///
/// Returns the new visibility state so the caller (main window UI) can sync
/// its toggle button without a separate query round-trip. Broadcasts
/// `pomodoro-float://visibility-changed` to all windows so any listener
/// (e.g. the float window's own close button having triggered a hide) stays
/// in sync regardless of which window initiated the toggle.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
pub fn toggle_pomodoro_float_window(app: &tauri::AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let is_visible = win.is_visible().unwrap_or(false);
        let new_state = if is_visible {
            let _ = win.hide();
            false
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            true
        };
        let _ = app.emit("pomodoro-float://visibility-changed", new_state);
        return Ok(new_state);
    }

    let win = tauri::WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        tauri::WebviewUrl::App("pomodoro-float".into()),
    )
    .title("Rapitas Pomodoro")
    .inner_size(300.0, 380.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .transparent(true)
    .center()
    .build()
    .map_err(|e| format!("Failed to create pomodoro-float window: {e}"))?;
    let _ = win.set_focus();
    let _ = app.emit("pomodoro-float://visibility-changed", true);
    Ok(true)
}

/// Tauri command: toggle the Pomodoro floating window (used by the main window's toggle button).
#[tauri::command]
pub fn toggle_pomodoro_float(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_pomodoro_float_window(&app)
}
