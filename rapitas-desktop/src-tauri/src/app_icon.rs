//! app_icon
//!
//! Picks the tray icon bitmap that matches the display scale and hides the
//! icon in the main window's title bar. The artwork itself is rendered by
//! `rapitas-desktop/scripts/render-small-icons.py`.

// Each integer size from 16 to 64 is independently rasterized in a 64px-wide
// atlas. Frame extraction does not resize the artwork.
const TRAY_ATLAS: &[u8] = include_bytes!("../icons/tray-atlas.png");
const MIN_SIZE: u32 = 16;
const MAX_SIZE: u32 = 64;
pub const TRAY_ID: &str = "main-tray";

pub fn tray_icon_size(scale: f64) -> u32 {
    if !scale.is_finite() || scale <= 0.0 {
        return MIN_SIZE;
    }
    ((16.0 * scale).round() as u32).clamp(MIN_SIZE, MAX_SIZE)
}

fn desired_size(app: &tauri::AppHandle) -> u32 {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winuser::{
            FindWindowW, GetDpiForWindow, GetSystemMetricsForDpi, SM_CXSMICON,
        };
        let class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        // SAFETY: class is NUL terminated; these APIs only query the shell.
        unsafe {
            let taskbar = FindWindowW(class.as_ptr(), std::ptr::null());
            if !taskbar.is_null() {
                let dpi = GetDpiForWindow(taskbar);
                if dpi > 0 {
                    let pixels = GetSystemMetricsForDpi(SM_CXSMICON, dpi);
                    if pixels > 0 {
                        return (pixels as u32).clamp(MIN_SIZE, MAX_SIZE);
                    }
                }
            }
        }
    }
    tray_icon_size(
        app.primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0),
    )
}

fn image_for_size(size: u32) -> tauri::Result<tauri::image::Image<'static>> {
    let atlas = tauri::image::Image::from_bytes(TRAY_ATLAS)?;
    let size = size.clamp(MIN_SIZE, MAX_SIZE);
    let top = (size - MIN_SIZE) * MAX_SIZE;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in top..top + size {
        let start = (y * MAX_SIZE * 4) as usize;
        rgba.extend_from_slice(&atlas.rgba()[start..start + (size * 4) as usize]);
    }
    Ok(tauri::image::Image::new_owned(rgba, size, size))
}

pub fn tray_icon_image(app: &tauri::App) -> tauri::Result<tauri::image::Image<'static>> {
    image_for_size(desired_size(app.handle()))
}

/// Hidden windows receive no useful move event when the taskbar changes DPI.
/// Poll shell metrics and replace the icon only when its required size changes.
pub fn watch_tray_scale(app: &tauri::App) {
    let handle = app.handle().clone();
    let mut current = desired_size(&handle);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let Some(tray) = handle.tray_by_id(TRAY_ID) else {
                break;
            };
            let wanted = desired_size(&handle);
            if wanted != current {
                match image_for_size(wanted).and_then(|image| tray.set_icon(Some(image))) {
                    Ok(()) => current = wanted,
                    Err(e) => eprintln!("[Tray] DPI image update failed: {e}"),
                }
            }
        }
    });
}

/// Register the main window for split view. Keep its normal title and icons:
/// DesktopTitleBar removes decorations only after its controls have mounted.
#[cfg(target_os = "windows")]
pub fn prepare_main_window(app: &tauri::App) {
    use tauri::Manager;
    if let Some(window) = app.get_window("main") {
        if let Ok(raw) = window.hwnd() {
            crate::window_manager::register_main_window(raw.0 as winapi::shared::windef::HWND);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_sizes_include_fractional_and_high_scales() {
        for (scale, size) in [
            (1.0, 16),
            (1.1, 18),
            (1.25, 20),
            (1.5, 24),
            (1.75, 28),
            (2.0, 32),
            (3.0, 48),
            (4.0, 64),
        ] {
            assert_eq!(tray_icon_size(scale), size);
        }
        assert_eq!(tray_icon_size(f64::NAN), 16);
        assert_eq!(tray_icon_size(-1.0), 16);
        assert_eq!(tray_icon_size(10.0), 64);
    }
    #[test]
    fn atlas_frames_are_valid_and_have_visible_artwork() {
        let atlas = tauri::image::Image::from_bytes(TRAY_ATLAS).unwrap();
        assert_eq!((atlas.width(), atlas.height()), (64, 49 * 64));
        for size in MIN_SIZE..=MAX_SIZE {
            let frame = image_for_size(size).unwrap();
            assert_eq!((frame.width(), frame.height()), (size, size));
            assert_eq!(frame.rgba().len(), (size * size * 4) as usize);
            assert!(frame
                .rgba()
                .chunks_exact(4)
                .any(|p| p == [255, 255, 255, 255]));
            assert_eq!(frame.rgba()[3], 0);
        }
    }
}
