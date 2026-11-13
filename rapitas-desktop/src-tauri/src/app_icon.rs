//! app_icon
//!
//! Picks the tray icon bitmap that matches the display scale and hides the
//! icon in the main window's title bar. The artwork itself is rendered by
//! `rapitas-desktop/scripts/render-small-icons.py`.

/// Tray bitmaps rendered pixel-for-pixel at each shell tray size.
///
/// NOTE: tray-icon turns the RGBA into a single-size HICON and the shell then
/// resamples it to the tray slot (16px at 100%, 20/24/32 at 125/150/200%).
/// Handing it a 256px bitmap made that resample smear the bars, so we ship the
/// exact sizes and pick one instead of letting the OS scale.
const TRAY_ICONS: [(u32, &[u8]); 4] = [
    (16, include_bytes!("../icons/tray-icon-16.png")),
    (20, include_bytes!("../icons/tray-icon-20.png")),
    (24, include_bytes!("../icons/tray-icon-24.png")),
    (32, include_bytes!("../icons/tray-icon-32.png")),
];

/// Choose the tray bitmap edge length for a display scale factor.
///
/// @param scale_factor - monitor scale (1.0 = 100%) / モニターの拡大率
/// @returns the smallest shipped size covering 16px at that scale / その拡大率で16pxを満たす最小のサイズ
pub fn tray_icon_size(scale_factor: f64) -> u32 {
    let wanted = (16.0 * scale_factor).round() as u32;
    TRAY_ICONS
        .iter()
        .map(|(size, _)| *size)
        .find(|size| *size >= wanted)
        .unwrap_or(TRAY_ICONS[TRAY_ICONS.len() - 1].0)
}

/// Load the tray icon image for the primary monitor's scale factor.
///
/// @param app - running app, used to read the monitor scale / 拡大率を読むためのアプリ
/// @returns decoded tray image / トレイ用画像
/// @throws tauri::Error when the embedded PNG cannot be decoded / PNG を復号できない場合
pub fn tray_icon_image(app: &tauri::App) -> tauri::Result<tauri::image::Image<'static>> {
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let size = tray_icon_size(scale);
    let bytes = TRAY_ICONS
        .iter()
        .find(|(s, _)| *s == size)
        .map(|(_, b)| *b)
        .unwrap_or(TRAY_ICONS[0].1);
    tauri::image::Image::from_bytes(bytes)
}

/// Hide the app icon and the title text drawn at the left of the main window's title bar.
///
/// The window title stays set, so the taskbar and Alt+Tab still show the icon
/// and "Rapitas"; only the caption stops drawing them.
///
/// @param app - running app that owns the "main" window / main ウィンドウを持つアプリ
#[cfg(target_os = "windows")]
pub fn hide_title_bar_icon_and_text(app: &tauri::App) {
    use tauri::Manager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::{
        SetWindowThemeAttribute, WTA_NONCLIENT, WTA_OPTIONS, WTNCA_NODRAWCAPTION, WTNCA_NODRAWICON,
    };

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(raw) = window.hwnd() else {
        return;
    };
    // tauri links a newer `windows` crate than ours, so pass the raw handle across.
    let hwnd = HWND(raw.0);
    let flags = WTNCA_NODRAWICON | WTNCA_NODRAWCAPTION;
    let options = WTA_OPTIONS {
        dwFlags: flags,
        dwMask: flags,
    };
    // SAFETY: hwnd is the live main window and `options` outlives the call.
    let result = unsafe {
        SetWindowThemeAttribute(
            hwnd,
            WTA_NONCLIENT,
            &options as *const WTA_OPTIONS as *const core::ffi::c_void,
            std::mem::size_of::<WTA_OPTIONS>() as u32,
        )
    };
    if let Err(e) = result {
        eprintln!("[Window] hiding title bar icon/text failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_exact_size_for_common_scales() {
        assert_eq!(tray_icon_size(1.0), 16);
        assert_eq!(tray_icon_size(1.25), 20);
        assert_eq!(tray_icon_size(1.5), 24);
        assert_eq!(tray_icon_size(2.0), 32);
    }

    #[test]
    fn rounds_up_between_sizes_and_caps_at_the_largest() {
        assert_eq!(tray_icon_size(1.1), 20);
        assert_eq!(tray_icon_size(1.75), 32);
        assert_eq!(tray_icon_size(3.0), 32);
    }

    #[test]
    fn every_tray_bitmap_has_the_size_it_is_listed_under() {
        for (size, bytes) in TRAY_ICONS {
            let image = tauri::image::Image::from_bytes(bytes).expect("tray png decodes");
            assert_eq!((image.width(), image.height()), (size, size));
        }
    }
}
