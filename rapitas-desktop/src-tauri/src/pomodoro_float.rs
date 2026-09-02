//! pomodoro_float
//!
//! Frameless, draggable floating window that mirrors the Pomodoro timer
//! outside the main window. Shown automatically at app startup and kept
//! taskbar-resident (plan.md 「起動時表示」「タスクバー常駐」) — unlike the
//! prior toggle-only design, closing it (the × button) now destroys the
//! window for real; app_setup.rs's CloseRequested handler only intercepts
//! the "main" window label, so this window is not force-hidden. Reopening
//! goes through the same get-or-build path as the main window's toggle
//! button.

use tauri::{Emitter, Manager};

const WINDOW_LABEL: &str = "pomodoro-float";

/// Build the Pomodoro floating window (not shown until the caller decides to).
///
/// `always_on_top` starts `false` — the window is taskbar-resident by default
/// (plan.md 設計判断の根拠 #1: 通常表示=常駐/最前面OFF、透過モード=オーバーレイ/最前面ON).
/// The frontend's `useTransparencyMode` calls `set_pomodoro_float_always_on_top`
/// right after mount to sync it to the persisted glass/opaque mode.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
fn build_pomodoro_float_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    tauri::WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        tauri::WebviewUrl::App("pomodoro-float".into()),
    )
    .title("Rapitas Pomodoro")
    .inner_size(300.0, 380.0)
    .decorations(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .resizable(false)
    // NOTE: builder-level transparency rendered the whole window WHITE on
    // Windows WebView2 (observed 2026-09-02). Opaque until a runtime glass
    // effect (acrylic / window-vibrancy) replaces it.
    .transparent(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create pomodoro-float window: {e}"))
}

/// Show the Pomodoro floating window at app startup, creating it if needed.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
pub fn show_or_create_pomodoro_float_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let _ = win.show();
    } else {
        build_pomodoro_float_window(app)?;
    }
    let _ = app.emit("pomodoro-float://visibility-changed", true);
    Ok(())
}

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

    let win = build_pomodoro_float_window(app)?;
    let _ = win.set_focus();
    let _ = app.emit("pomodoro-float://visibility-changed", true);
    Ok(true)
}

/// Tauri command: toggle the Pomodoro floating window (used by the main window's toggle button).
#[tauri::command]
pub fn toggle_pomodoro_float(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_pomodoro_float_window(&app)
}

/// Tauri command: query whether the Pomodoro floating window is currently visible.
///
/// Used by `GlobalPomodoroModal` on mount to sync its toggle button state,
/// since the window may already be showing from app startup before the modal
/// ever subscribes to the visibility-changed event.
#[tauri::command]
pub fn pomodoro_float_is_visible(app: tauri::AppHandle) -> bool {
    app.get_webview_window(WINDOW_LABEL)
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(false)
}

/// Tauri command: set the Pomodoro floating window's always-on-top state.
///
/// Called by the frontend whenever the glass/opaque transparency mode
/// changes (plan.md 設計判断の根拠 #1). No-op if the window does not exist yet.
///
/// # Errors
/// Returns a message when the underlying window API call fails.
#[tauri::command]
pub fn set_pomodoro_float_always_on_top(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        win.set_always_on_top(on)
            .map_err(|e| format!("Failed to set always-on-top: {e}"))?;
    }
    Ok(())
}
