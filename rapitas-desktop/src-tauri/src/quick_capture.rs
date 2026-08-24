//! quick_capture
//!
//! Quick idea-capture popup window management and its Tauri command.

use tauri::{Emitter, Manager};

/// Show (or lazily create) the always-on-top quick idea-capture popup window.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
pub fn show_quick_capture_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quick-capture") {
        // NOTE: no re-center on reuse — the user can drag the popup where they
        // want it, and it must reappear there, not snap back to the middle.
        let _ = win.show();
        let _ = win.set_focus();
        // Tell the page to clear its input for a fresh capture.
        let _ = win.emit("quick-capture:show", ());
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        "quick-capture",
        tauri::WebviewUrl::App("quick-capture".into()),
    )
    .title("Rapitas Quick Capture")
    // NOTE: keep in sync with WINDOW_WIDTH/HEIGHT in app/quick-capture/page.tsx
    // (the page also self-resizes so older binaries pick up layout changes).
    .inner_size(640.0, 320.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create quick-capture window: {e}"))?;
    let _ = win.set_focus();
    Ok(())
}

/// Tauri command: open the quick idea-capture popup (also used by the tray menu).
#[tauri::command]
pub fn open_quick_capture(app: tauri::AppHandle) -> Result<(), String> {
    show_quick_capture_window(&app)
}
