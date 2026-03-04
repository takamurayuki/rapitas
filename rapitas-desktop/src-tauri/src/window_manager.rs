use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
#[cfg(target_os = "windows")]
use winapi::{
    shared::{
        minwindef::{BOOL, LPARAM, TRUE},
        windef::{HWND, RECT},
    },
    um::{
        dwmapi::DwmGetWindowAttribute,
        winuser::{
            EnumWindows, GetWindowRect, GetWindowTextW, IsWindowVisible, SetForegroundWindow,
            SetWindowPos, ShowWindow, SWP_FRAMECHANGED, SWP_NOZORDER, SW_NORMAL, SW_RESTORE,
        },
    },
};

#[cfg(target_os = "windows")]
pub struct WindowInfo {
    pub hwnd: HWND,
    pub title: String,
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

        windows.push(WindowInfo {
            hwnd,
            title: title_string,
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
            work_area.bottom - work_area.top,
        )
    }
}

/// DWMの不可視ボーダー（リサイズハンドル用透明領域）のサイズを取得する。
/// 返り値: (border_left, border_top, border_right, border_bottom)
#[cfg(target_os = "windows")]
pub fn get_invisible_border(hwnd: HWND) -> (i32, i32, i32, i32) {
    unsafe {
        let mut window_rect: RECT = std::mem::zeroed();
        let mut frame_rect: RECT = std::mem::zeroed();

        if GetWindowRect(hwnd, &mut window_rect) == 0 {
            return (7, 0, 7, 7); // フォールバック値
        }

        // DWMWA_EXTENDED_FRAME_BOUNDS = 9
        let hr = DwmGetWindowAttribute(
            hwnd,
            9,
            &mut frame_rect as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );

        if hr != 0 {
            return (7, 0, 7, 7); // フォールバック値
        }

        let border_left = frame_rect.left - window_rect.left;
        let border_top = frame_rect.top - window_rect.top;
        let border_right = window_rect.right - frame_rect.right;
        let border_bottom = window_rect.bottom - frame_rect.bottom;

        (border_left, border_top, border_right, border_bottom)
    }
}

#[cfg(target_os = "windows")]
pub fn set_window_split_left_with_height(hwnd: HWND, _screen_width: i32, _height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        let (work_x, work_y, work_width, work_height) = get_work_area();
        let (bl, _bt, br, bb) = get_invisible_border(hwnd);

        // 不可視ボーダーを補正して可視領域がぴったり左半分になるよう配置
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

#[cfg(target_os = "windows")]
pub fn set_window_split_right_with_height(hwnd: HWND, _screen_width: i32, _height: i32) {
    unsafe {
        // ウィンドウを通常表示に戻す
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_NORMAL);

        let (work_x, work_y, work_width, work_height) = get_work_area();
        let (bl, _bt, br, bb) = get_invisible_border(hwnd);

        // 不可視ボーダーを補正して可視領域がぴったり右半分になるよう配置
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            work_x + work_width / 2 - bl,
            work_y,
            work_width / 2 + bl + br,
            work_height + bb,
            SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}
