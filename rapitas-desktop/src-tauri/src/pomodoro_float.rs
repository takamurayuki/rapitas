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
    .inner_size(400.0, 640.0)
    .min_inner_size(340.0, 460.0)
    .decorations(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .resizable(true)
    .transparent(true)
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

/// Tauri command: bring the Pomodoro floating window to the foreground,
/// creating it if needed. Replaces GlobalPomodoroModal's open/close as the
/// only entry point now that the modal is deleted.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
#[tauri::command]
pub fn focus_pomodoro_float(app: tauri::AppHandle) -> Result<(), String> {
    let win = match app.get_webview_window(WINDOW_LABEL) {
        Some(win) => win,
        None => build_pomodoro_float_window(&app)?,
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
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
