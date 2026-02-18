#[cfg(target_os = "windows")]
use winapi::{
    um::{
        winuser::{
            SetWindowPos, ShowWindow, GetForegroundWindow,
            SWP_FRAMECHANGED, SWP_NOZORDER, SW_NORMAL, SW_RESTORE, SW_SHOWMINIMIZED,
            SW_SHOWMAXIMIZED, GetWindowPlacement, WINDOWPLACEMENT,
        },
    },
};

use std::thread;
use std::time::Duration;

#[cfg(target_os = "windows")]
pub fn split_screen_with_browser(url: &str, _screen_width: i32, _screen_height: i32) -> Result<(), String> {
    use crate::window_manager::*;
    use crate::browser_launcher;

    // 作業領域（タスクバーを除いた領域）を取得
    let (work_x, work_y, work_width, work_height) = get_work_area();

    // Step 1: 既存のブラウザウィンドウを検出
    let all_windows = get_all_windows();
    let mut existing_browser_hwnd = None;
    let mut fullscreen_browsers = Vec::new();
    let mut active_browser_hwnd = None;

    for window in &all_windows {
        let title_lower = window.title.to_lowercase();
        // より正確なブラウザ検出（実行ファイル名も考慮）
        if title_lower.contains("chrome") ||
           title_lower.contains("edge") ||
           title_lower.contains("firefox") ||
           title_lower.contains("opera") ||
           title_lower.contains("brave") ||
           title_lower.contains("vivaldi") ||
           title_lower.contains("microsoft edge") ||
           title_lower.contains("google chrome") {

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
                    // 全画面表示または最大化されている場合
                    if placement.showCmd == SW_SHOWMAXIMIZED as u32 {
                        fullscreen_browsers.push(window.hwnd);
                    }
                    // 最初に見つかったブラウザを記憶
                    if existing_browser_hwnd.is_none() {
                        existing_browser_hwnd = Some(window.hwnd);
                    }

                    // アクティブなブラウザウィンドウを記憶（フォアグラウンドにあるもの）
                    if GetForegroundWindow() == window.hwnd {
                        active_browser_hwnd = Some(window.hwnd);
                    }
                }
            }
        }
    }

    // Step 2: 全画面ブラウザを通常表示に戻す
    for hwnd in fullscreen_browsers {
        unsafe {
            // まず最小化してから復元（全画面解除のため）
            ShowWindow(hwnd, SW_SHOWMINIMIZED);
            thread::sleep(Duration::from_millis(50));
            ShowWindow(hwnd, SW_RESTORE);
            thread::sleep(Duration::from_millis(50));
            ShowWindow(hwnd, SW_NORMAL);
            thread::sleep(Duration::from_millis(100));

            // 左半分に配置（作業領域を考慮）
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                work_x,
                work_y,
                work_width / 2,
                work_height,
                SWP_NOZORDER | SWP_FRAMECHANGED,
            );
        }
    }

    // Step 3: Rapitasを右半分に配置
    if let Some(rapitas_hwnd) = find_rapitas_window() {
        set_window_split_right_with_height(rapitas_hwnd, work_width, work_height);
    }

    // Step 4: ブラウザで新しいURLを開く（既存のブラウザで新しいタブとして開く）
    browser_launcher::launch_browser_with_size(url, work_x, work_y, work_width / 2, work_height)?;

    // Step 5: 既存のブラウザウィンドウまたは新しく開いたブラウザウィンドウを配置
    thread::sleep(Duration::from_millis(1000));

    // アクティブなブラウザウィンドウを優先、なければ既存のブラウザウィンドウを使用
    let browser_to_use = active_browser_hwnd.or(existing_browser_hwnd);

    if let Some(hwnd) = browser_to_use {
        set_window_split_left_with_height(hwnd, work_width, work_height);
    } else {
        // 新しく開いたブラウザウィンドウを見つけて配置
        let latest_windows = get_all_windows();
        for window in latest_windows {
            let title_lower = window.title.to_lowercase();
            if title_lower.contains("chrome") ||
               title_lower.contains("edge") ||
               title_lower.contains("firefox") ||
               title_lower.contains("opera") ||
               title_lower.contains("brave") ||
               title_lower.contains("vivaldi") {
                set_window_split_left_with_height(window.hwnd, work_width, work_height);
                break;
            }
        }
    }

    // Step 6: 最後にRapitasにフォーカスを戻す
    thread::sleep(Duration::from_millis(200));
    if let Some(rapitas_hwnd) = find_rapitas_window() {
        focus_window(rapitas_hwnd);
    }

    Ok(())
}