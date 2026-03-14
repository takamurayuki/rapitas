#[cfg(target_os = "windows")]
use winapi::um::winuser::{
    GetForegroundWindow, GetWindowPlacement, SetWindowPos, ShowWindow, SWP_FRAMECHANGED,
    SWP_NOZORDER, SW_NORMAL, SW_RESTORE, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, WINDOWPLACEMENT,
};

use std::thread;
use std::time::Duration;

#[cfg(target_os = "windows")]
pub fn split_screen_with_browser(
    url: &str,
    _screen_width: i32,
    _screen_height: i32,
) -> Result<(), String> {
    use crate::browser_launcher;
    use crate::window_manager::*;

    // Get work area (excludes taskbar)
    let (work_x, work_y, work_width, work_height) = get_work_area();

    // Step 1: Detect existing browser windows
    let all_windows = get_all_windows();
    let mut existing_browser_hwnd = None;
    let mut fullscreen_browsers = Vec::new();
    let mut active_browser_hwnd = None;

    for window in &all_windows {
        let title_lower = window.title.to_lowercase();
        // Match browser windows by title keywords
        if title_lower.contains("chrome")
            || title_lower.contains("edge")
            || title_lower.contains("firefox")
            || title_lower.contains("opera")
            || title_lower.contains("brave")
            || title_lower.contains("vivaldi")
            || title_lower.contains("microsoft edge")
            || title_lower.contains("google chrome")
        {
            unsafe {
                let mut placement = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    flags: 0,
                    showCmd: 0,
                    ptMinPosition: winapi::shared::windef::POINT { x: 0, y: 0 },
                    ptMaxPosition: winapi::shared::windef::POINT { x: 0, y: 0 },
                    rcNormalPosition: winapi::shared::windef::RECT {
                        left: 0,
                        top: 0,
                        right: 0,
                        bottom: 0,
                    },
                };

                if GetWindowPlacement(window.hwnd, &mut placement) != 0 {
                    if placement.showCmd == SW_SHOWMAXIMIZED as u32 {
                        fullscreen_browsers.push(window.hwnd);
                    }
                    if existing_browser_hwnd.is_none() {
                        existing_browser_hwnd = Some(window.hwnd);
                    }

                    // Track the foreground browser window for priority use later
                    if GetForegroundWindow() == window.hwnd {
                        active_browser_hwnd = Some(window.hwnd);
                    }
                }
            }
        }
    }

    // Step 2: Restore maximized browsers to normal state
    for hwnd in fullscreen_browsers {
        unsafe {
            // Minimize then restore to break out of maximized state
            ShowWindow(hwnd, SW_SHOWMINIMIZED);
            thread::sleep(Duration::from_millis(50));
            ShowWindow(hwnd, SW_RESTORE);
            thread::sleep(Duration::from_millis(50));
            ShowWindow(hwnd, SW_NORMAL);
            thread::sleep(Duration::from_millis(100));

            let (bl, _bt, br, bb) = get_invisible_border(hwnd);

            // Position in left half, compensating for invisible borders
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                work_x - bl,
                work_y,
                work_width / 2 + bl + br,
                work_height + bb,
                SWP_NOZORDER | SWP_FRAMECHANGED,
            );
        }
    }

    // Step 3: Position Rapitas in the right half
    if let Some(rapitas_hwnd) = find_rapitas_window() {
        set_window_split_right_with_height(rapitas_hwnd, work_width, work_height);
    }

    // Step 4: Open the URL as a new tab in the existing browser
    browser_launcher::launch_browser_with_size(url, work_x, work_y, work_width / 2, work_height)?;

    // Step 5: Position the browser window in the left half
    thread::sleep(Duration::from_millis(1000));

    // Prefer the foreground browser window; fall back to any existing one
    let browser_to_use = active_browser_hwnd.or(existing_browser_hwnd);

    if let Some(hwnd) = browser_to_use {
        set_window_split_left_with_height(hwnd, work_width, work_height);
    } else {
        // Find and position the newly opened browser window
        let latest_windows = get_all_windows();
        for window in latest_windows {
            let title_lower = window.title.to_lowercase();
            if title_lower.contains("chrome")
                || title_lower.contains("edge")
                || title_lower.contains("firefox")
                || title_lower.contains("opera")
                || title_lower.contains("brave")
                || title_lower.contains("vivaldi")
            {
                set_window_split_left_with_height(window.hwnd, work_width, work_height);
                break;
            }
        }
    }

    // Step 6: Return focus to Rapitas
    thread::sleep(Duration::from_millis(200));
    if let Some(rapitas_hwnd) = find_rapitas_window() {
        focus_window(rapitas_hwnd);
    }

    Ok(())
}
