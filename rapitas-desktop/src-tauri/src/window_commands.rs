//! window_commands
//!
//! Main-window visibility helper and window decoration query command.

use tauri::{Emitter, Manager};

/// Tauri command: get window decoration info.
#[tauri::command]
pub fn get_window_decorations(window: tauri::Window) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use serde_json::json;

        // NOTE: Fixed value without DPI scaling; sufficient for current use case
        let title_bar_height = 32;
        Ok(json!({
            "titleBarHeight": title_bar_height,
            "hasDecorations": window.is_decorated().unwrap_or(true),
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        use serde_json::json;
        Ok(json!({
            "titleBarHeight": 0,
            "hasDecorations": window.is_decorated().unwrap_or(true),
        }))
    }
}

/// Show and focus the main window.
///
/// On Windows, the hide -> show -> unminimize -> set_focus sequence is required
/// to reliably bring the window to the foreground.
pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        // NOTE: visibilitychange is unreliable when Tauri hides/shows a window
        // via ShowWindow(). Emit a custom event so the frontend SSE manager can
        // pause/resume reliably without depending on the browser visibility API.
        let _ = window.emit("rapitas:window-show", ());
    }
}
