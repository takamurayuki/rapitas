//! rapi_float
//!
//! ラピ's own window: frameless, transparent, laid exactly over the main
//! window's client area and owned by it, so she is drawn above everything
//! the main window shows — the header, and the in-app browser's child
//! webviews, which are OS surfaces no HTML z-index can rise above (#1535).
//!
//! The window is as big as the main window's client area on purpose: the
//! page inside it lays her out with the same viewport the main window has,
//! so her corner offsets, the panel placement and the drag all stay the code
//! they were. Clicks reach it only where she is drawn — the page reports
//! those rectangles, and a polling thread turns cursor pass-through off while
//! the pointer is inside one and back on when it leaves.
//!
//! The window is shown while the main window is, and hidden while it is
//! minimised or in the tray: an owned window follows its owner's minimise
//! but not a hide. Not responsible for anything she shows — when she is kept
//! off a page or out of a dialog's way, her page draws nothing and reports
//! no rectangles, so the window stays up and the focus never moves.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{Emitter, Manager};

/// The window's label, and the route it loads.
pub const RAPI_FLOAT_LABEL: &str = "rapi-float";

/// Emitted to the window when it is shown or hidden, for its stale-document check.
pub const VISIBILITY_EVENT: &str = "rapi-float://visibility-changed";

const MAIN_LABEL: &str = "main";

/// How often the cursor is tested against her rectangles.
///
/// 30ms is under two frames: the hand gets there before the switch is
/// noticed, and between switches each pass is one `GetCursorPos`.
const HIT_POLL: Duration = Duration::from_millis(30);

/// How often the main window's visibility is re-read.
///
/// Slower than the hit test because each read is a round trip through the
/// event loop, and a window minimised or hidden to the tray is not a thing
/// that needs noticing within a frame.
const VISIBILITY_POLL: Duration = Duration::from_millis(500);

/// A rectangle she occupies, in CSS pixels of the page. / ラピが描かれた矩形
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Whether a point in CSS pixels falls inside any of her rectangles.
///
/// # Arguments
/// * `rects` - Where she is drawn / 描画されている矩形
/// * `x`, `y` - The pointer, relative to the window's client area / ポインタ位置
pub fn hits(rects: &[HitRect], x: f64, y: f64) -> bool {
    rects
        .iter()
        .any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
}

/// Where the window sits on screen, cached so the hit test needs no round trip.
#[derive(Debug, Clone, Copy, Default)]
struct Origin {
    x: f64,
    y: f64,
    scale: f64,
}

/// What the commands and the polling thread share.
#[derive(Default)]
pub struct RapiFloatState {
    rects: Mutex<Vec<HitRect>>,
    origin: Mutex<Origin>,
    /// Bumped whenever the rectangles or the window's origin change.
    generation: AtomicU64,
}

/// Build the window, hidden, owned by the main window.
///
/// Called once at startup, before any in-app browser tab exists: adding a
/// child webview to "main" turns it into a multi-webview window, after which
/// `get_webview_window("main")` no longer finds it and there is nothing left
/// to own this window by.
///
/// # Errors
/// Returns a message when the main window is missing or the window cannot be built.
pub fn prewarm(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(RAPI_FLOAT_LABEL).is_some() {
        return Ok(());
    }
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or("Main window not found")?;
    tauri::WebviewWindowBuilder::new(
        app,
        RAPI_FLOAT_LABEL,
        tauri::WebviewUrl::App(RAPI_FLOAT_LABEL.into()),
    )
    .title("Rapitas Rapi")
    .decorations(false)
    .shadow(false)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    // NOTE: transparent(true) alone whited out the Pomodoro window on this
    // WebView2 build (pomodoro_float.rs). With the webview's own background
    // set to alpha 0 as well it composites correctly — verified 2026-11-14
    // with a probe over a child webview before this was written.
    .transparent(true)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .visible(false)
    .parent(&main)
    .map_err(|e| format!("Failed to own the Rapi window by main: {e}"))?
    .build()
    .map_err(|e| format!("Failed to create the Rapi window: {e}"))?;
    follow_main(app);
    spawn_poller(app.clone());
    Ok(())
}

/// Lay the window over the main window's client area again.
///
/// Called on the main window's move, resize and scale changes.
pub fn follow_main(app: &tauri::AppHandle) {
    let (Some(main), Some(win)) = (
        app.get_window(MAIN_LABEL),
        app.get_webview_window(RAPI_FLOAT_LABEL),
    ) else {
        return;
    };
    let (Ok(pos), Ok(size), Ok(scale)) = (
        main.inner_position(),
        main.inner_size(),
        main.scale_factor(),
    ) else {
        return;
    };
    let _ = win.set_position(pos);
    let _ = win.set_size(size);
    if let Some(state) = app.try_state::<RapiFloatState>() {
        if let Ok(mut origin) = state.origin.lock() {
            *origin = Origin {
                x: pos.x as f64,
                y: pos.y as f64,
                scale,
            };
        }
        state.generation.fetch_add(1, Ordering::Relaxed);
    }
}

/// Tauri command: the rectangles she is drawn in, from her page.
#[tauri::command]
pub fn set_rapi_float_hit_rects(state: tauri::State<'_, RapiFloatState>, rects: Vec<HitRect>) {
    if let Ok(mut current) = state.rects.lock() {
        *current = rects;
    }
    state.generation.fetch_add(1, Ordering::Relaxed);
}

#[cfg(target_os = "windows")]
fn cursor() -> Option<(f64, f64)> {
    use winapi::shared::windef::POINT;
    use winapi::um::winuser::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes into the POINT it is given and nothing else.
    let ok = unsafe { GetCursorPos(&mut p) };
    (ok != 0).then_some((p.x as f64, p.y as f64))
}

#[cfg(not(target_os = "windows"))]
fn cursor() -> Option<(f64, f64)> {
    None
}

/// Show her window, then hand the keyboard back to main if main had it.
///
/// Shown only when main itself comes back (restored, or out of the tray),
/// never for a dialog: those hide her by drawing nothing, so the window is
/// not shown and hidden under the user's hands.
///
/// NOTE: `show()` activates the window. tao clears its don't-focus marker
/// right after creation, so `focused(false)` covers only the first show, and
/// a raw `ShowWindow(SW_SHOWNOACTIVATE)` is undone by tao, whose own visible
/// flag still says hidden (both verified 2026-11-14).
fn show_returning_focus(app: &tauri::AppHandle, win: &tauri::WebviewWindow) {
    let main = app.get_window(MAIN_LABEL);
    let main_had_focus = main
        .as_ref()
        .is_some_and(|m| m.is_focused().unwrap_or(false));
    let _ = win.show();
    if main_had_focus {
        if let Some(m) = main {
            let _ = m.set_focus();
        }
    }
}

fn spawn_poller(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Looked up once: both live for the app's lifetime (neither is ever
        // closed), and a lookup per pass was most of this loop's cost.
        let (Some(win), Some(main)) = (
            app.get_webview_window(RAPI_FLOAT_LABEL),
            app.get_window(MAIN_LABEL),
        ) else {
            return;
        };
        let Some(state) = app.try_state::<RapiFloatState>() else {
            return;
        };
        let mut shown = false;
        let mut passing: Option<bool> = None;
        let mut last_visibility = Instant::now() - VISIBILITY_POLL;
        // What the last hit test saw, so a still pointer over unchanged
        // rectangles costs one `GetCursorPos` and nothing else.
        let mut last_seen: Option<((f64, f64), u64)> = None;
        loop {
            std::thread::sleep(HIT_POLL);

            if last_visibility.elapsed() >= VISIBILITY_POLL {
                last_visibility = Instant::now();
                let main_up =
                    main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(true);
                if main_up != shown {
                    if main_up {
                        follow_main(&app);
                        show_returning_focus(&app, &win);
                    } else {
                        let _ = win.hide();
                    }
                    shown = main_up;
                    passing = None;
                    last_seen = None;
                    let _ = app.emit_to(RAPI_FLOAT_LABEL, VISIBILITY_EVENT, main_up);
                }
            }
            if !shown {
                continue;
            }

            let Some(pointer) = cursor() else { continue };
            let generation = state.generation.load(Ordering::Relaxed);
            if last_seen == Some((pointer, generation)) {
                continue;
            }
            last_seen = Some((pointer, generation));

            let inside = match (state.origin.lock(), state.rects.lock()) {
                (Ok(origin), Ok(rects)) if origin.scale > 0.0 => hits(
                    &rects,
                    (pointer.0 - origin.x) / origin.scale,
                    (pointer.1 - origin.y) / origin.scale,
                ),
                _ => false,
            };
            if passing != Some(!inside) {
                let _ = win.set_ignore_cursor_events(!inside);
                passing = Some(!inside);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const AVATAR: HitRect = HitRect {
        x: 100.0,
        y: 200.0,
        width: 68.0,
        height: 68.0,
    };

    #[test]
    fn a_point_on_her_hits() {
        assert!(hits(&[AVATAR], 100.0, 200.0));
        assert!(hits(&[AVATAR], 167.9, 267.9));
    }

    #[test]
    fn a_point_beside_her_passes_through() {
        assert!(!hits(&[AVATAR], 99.9, 230.0));
        assert!(!hits(&[AVATAR], 168.0, 230.0));
        assert!(!hits(&[AVATAR], 130.0, 268.0));
    }

    #[test]
    fn nothing_reported_means_everything_passes_through() {
        assert!(!hits(&[], 0.0, 0.0));
    }

    #[test]
    fn any_of_several_rectangles_hits() {
        let panel = HitRect {
            x: 0.0,
            y: 0.0,
            width: 448.0,
            height: 600.0,
        };
        assert!(hits(&[AVATAR, panel], 10.0, 10.0));
    }
}
