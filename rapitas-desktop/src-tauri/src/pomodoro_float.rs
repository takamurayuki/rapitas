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
use window_vibrancy::{apply_acrylic, clear_acrylic};

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
    // NOTE: transparent(true) renders the WHOLE window white on this
    // machine's WebView2 (verified twice, 2026-09-02) — the page content
    // never composites. Opaque until glass ships via window-vibrancy
    // acrylic, which bypasses the transparent-window compositing path.
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

/// Tauri command: apply or clear the acrylic glass effect on the Pomodoro
/// floating window. The window itself stays `transparent(false)` (see
/// `build_pomodoro_float_window` — `transparent(true)` whites out the whole
/// window on this WebView2 build); acrylic supplies the glass look via DWM
/// composition instead, which requires the webview's own background to
/// be alpha-0 or the opaque webview paints over the acrylic blur.
///
/// Never returns `Err` to the caller — on any failure (unsupported platform,
/// pre-1809 Windows build, missing window) it resets to the opaque state and
/// returns `Ok(false)` so the frontend can fall back to the opaque CSS
/// without the invoke promise rejecting (plan.md 設計判断の根拠 「適用失敗時の戻り値」).
///
/// # Errors
/// Never returns `Err` — see above.
#[tauri::command]
pub fn set_pomodoro_float_acrylic(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let win = match app.get_webview_window(WINDOW_LABEL) {
        Some(win) => win,
        None => return Ok(false),
    };

    if !enabled {
        let _ = clear_acrylic(&win);
        let _ = win.set_background_color(None);
        return Ok(false);
    }

    if win
        .set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
        .is_err()
    {
        let _ = clear_acrylic(&win);
        let _ = win.set_background_color(None);
        return Ok(false);
    }

    match apply_acrylic(&win, Some((0, 0, 0, 1))) {
        Ok(()) => Ok(true),
        Err(e) => {
            eprintln!("[pomodoro-float] apply_acrylic failed, falling back to opaque: {e}");
            let _ = clear_acrylic(&win);
            let _ = win.set_background_color(None);
            Ok(false)
        }
    }
}
