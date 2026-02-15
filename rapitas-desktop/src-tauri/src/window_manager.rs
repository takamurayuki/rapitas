use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
#[cfg(target_os = "windows")]
use winapi::{
    shared::{
        minwindef::{BOOL, LPARAM, TRUE},
        windef::{HWND, RECT},
    },
    um::winuser::{
        EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowTextW, IsWindowVisible,
        SetForegroundWindow, SetWindowPos, ShowWindow, SWP_FRAMECHANGED, SWP_NOZORDER, SWP_NOACTIVATE,
        SW_NORMAL, SW_RESTORE,
    },
};

#[cfg(target_os = "windows")]
pub struct WindowInfo {
    pub hwnd: HWND,
    pub title: String,
    pub rect: RECT,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam as *mut Vec<WindowInfo>);

    // ウィンドウが表示されているかチェック
    if IsWindowVisible(hwnd) == 0 {
        return TRUE;
    }

    // ウィンドウタイトルを取得
    let mut title: [u16; 256] = [0; 256];
    let len = GetWindowTextW(hwnd, title.as_mut_ptr(), 256);

    if len > 0 {
        let title_string = OsString::from_wide(&title[..len as usize])
            .to_string_lossy()
            .to_string();

        // ウィンドウの位置とサイズを取得
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);

        windows.push(WindowInfo {
            hwnd,
            title: title_string,
            rect,
        });
    }

    TRUE
}

#[cfg(target_os = "windows")]
pub fn get_all_windows() -> Vec<WindowInfo> {
    unsafe {
        let mut windows = Vec::new();
        EnumWindows(
            Some(enum_windows_callback),
            &mut windows as *mut Vec<WindowInfo> as LPARAM,
        );
        windows
    }
}

#[cfg(target_os = "windows")]
pub fn find_browser_window() -> Option<HWND> {
    let browser_keywords = vec!["Chrome", "Edge", "Firefox", "Opera", "Brave", "Vivaldi"];
    let windows = get_all_windows();

    for window in windows {
        for keyword in &browser_keywords {
            if window.title.contains(keyword) {
                return Some(window.hwnd);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
pub fn set_window_split_left(hwnd: HWND, screen_width: i32, screen_height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        // 左半分に配置
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            screen_width / 2,
            screen_height,
            SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(target_os = "windows")]
pub fn set_window_split_right(hwnd: HWND, screen_width: i32, screen_height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        // 右半分に配置
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            screen_width / 2,
            0,
            screen_width / 2,
            screen_height,
            SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(target_os = "windows")]
pub fn find_rapitas_window() -> Option<HWND> {
    let windows = get_all_windows();

    for window in windows {
        if window.title.contains("Rapitas") {
            return Some(window.hwnd);
        }
    }

    None
}

#[cfg(target_os = "windows")]
pub fn focus_window(hwnd: HWND) {
    unsafe {
        SetForegroundWindow(hwnd);
    }
}

#[cfg(target_os = "windows")]
pub fn get_work_area_height() -> i32 {
    use winapi::um::winuser::{SystemParametersInfoW, SPI_GETWORKAREA};

    unsafe {
        let mut work_area: RECT = std::mem::zeroed();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work_area as *mut RECT as *mut _, 0);
        work_area.bottom - work_area.top
    }
}

#[cfg(target_os = "windows")]
pub fn get_work_area() -> (i32, i32, i32, i32) {
    use winapi::um::winuser::{SystemParametersInfoW, SPI_GETWORKAREA};

    unsafe {
        let mut work_area: RECT = std::mem::zeroed();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work_area as *mut RECT as *mut _, 0);
        (
            work_area.left,
            work_area.top,
            work_area.right - work_area.left,
            work_area.bottom - work_area.top
        )
    }
}

#[cfg(target_os = "windows")]
pub fn set_window_split_left_with_height(hwnd: HWND, screen_width: i32, height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        let (work_x, work_y, work_width, work_height) = get_work_area();

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

#[cfg(target_os = "windows")]
pub fn set_window_split_right_with_height(hwnd: HWND, screen_width: i32, height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        let (work_x, work_y, work_width, work_height) = get_work_area();

        // 右半分に配置（作業領域を考慮）
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            work_x + work_width / 2,
            work_y,
            work_width / 2,
            work_height,
            SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}
