//! today_todo
//!
//! Today's suggested-todo popup window management and its Tauri command.

use tauri::{Emitter, Manager};

/// Show (or lazily create) the always-on-top today's suggested-todo popup window.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
pub fn show_today_todo_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("today-todo") {
        // NOTE: no re-center on reuse — same rationale as quick-capture, the
        // user's chosen popup position must survive across shortcut presses.
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("today-todo:show", ());
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        "today-todo",
        tauri::WebviewUrl::App("today-todo".into()),
    )
    .title("Rapitas Today's Todo")
    // NOTE: keep in sync with WINDOW_WIDTH/HEIGHT in app/today-todo/page.tsx.
    .inner_size(600.0, 400.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create today-todo window: {e}"))?;
    let _ = win.set_focus();
    Ok(())
}

/// Tauri command: open today's suggested-todo popup.
#[tauri::command]
pub fn open_today_todo(app: tauri::AppHandle) -> Result<(), String> {
    show_today_todo_window(&app)
}
