//! browser
//!
//! Split-screen view and external browser launching Tauri commands.
//! Not responsible for browser path resolution (see browser_launcher).

#[cfg(not(target_os = "windows"))]
use tauri::Manager;

/// Tauri command: open a URL in split-screen view using the chosen (App
/// Settings) or native browser. `browser` is a preset key (chrome/msedge/firefox).
#[tauri::command]
pub async fn open_split_view(
    app: tauri::AppHandle,
    url: String,
    browser: Option<String>,
) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {e}"))?
        .ok_or("No monitor found")?;

    let screen_size = monitor.size();
    let screen_width = screen_size.width as i32;
    let screen_height = screen_size.height as i32;

    #[cfg(target_os = "windows")]
    {
        crate::split_screen_manager::split_screen_with_browser(
            &url,
            screen_width,
            screen_height,
            browser.as_deref(),
        )?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &browser; // non-Windows split uses the OS default browser
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.unmaximize().ok();
            main_window
                .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: screen_width / 2,
                    y: 0,
                }))
                .ok();
            main_window
                .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: (screen_width / 2) as u32,
                    height: screen_height as u32,
                }))
                .ok();
            main_window.show().ok();
        }

        open::that(&url).map_err(|e| format!("Failed to launch browser: {e}"))?;

        // Return focus to the main window after the browser opens
        std::thread::sleep(std::time::Duration::from_millis(1000));
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.set_focus().ok();
        }
    }

    Ok(())
}

/// Open a URL in a SPECIFIC browser chosen in App Settings.
///
/// `browser` is a preset key (`chrome` / `msedge` / `firefox`) mapped to the
/// per-OS launcher. On Windows we go through `cmd /C start`, which resolves the
/// browser via the registry App Paths — a bare process spawn of "chrome" fails
/// because it isn't on PATH (the cause of the "not found" error users hit).
#[tauri::command]
pub async fn open_url_in_browser(url: String, browser: String) -> Result<(), String> {
    // SECURITY: this command is reachable from the webview (withGlobalTauri: true)
    // and historically piped `url` / `browser` straight into `cmd /C start`, where
    // cmd.exe re-parses the arguments (the CVE-2024-24576 "BatBadBut" class) — a
    // real RCE sink. The `other => other` fallthrough also let an arbitrary program
    // name through. Mitigate at the sink: (1) only allow http(s) URLs, (2) restrict
    // `browser` to known presets, (3) spawn the resolved browser EXE directly so the
    // URL is a single argv that is never handed to a shell for re-parsing. Unknown
    // presets fall back to the OS default handler — never an arbitrary executable.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) URLs may be opened".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        match crate::browser_launcher::browser_path_for_preset(&browser) {
            Some(path) => {
                std::process::Command::new(path)
                    .arg(&url)
                    .spawn()
                    .map_err(|e| format!("Failed to launch browser: {e}"))?;
            }
            None => open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))?,
        }
    }

    #[cfg(target_os = "macos")]
    {
        let app = match browser.as_str() {
            "chrome" => Some("Google Chrome"),
            "msedge" | "edge" => Some("Microsoft Edge"),
            "firefox" => Some("Firefox"),
            _ => None,
        };
        match app {
            Some(app) => {
                std::process::Command::new("open")
                    .args(["-a", app, &url])
                    .spawn()
                    .map_err(|e| format!("Failed to launch {app}: {e}"))?;
            }
            None => open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))?,
        }
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let app = match browser.as_str() {
            "chrome" => Some("google-chrome"),
            "msedge" | "edge" => Some("microsoft-edge"),
            "firefox" => Some("firefox"),
            _ => None,
        };
        match app {
            Some(app) => {
                std::process::Command::new(app)
                    .arg(&url)
                    .spawn()
                    .map_err(|e| format!("Failed to launch {app}: {e}"))?;
            }
            None => open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))?,
        }
    }

    Ok(())
}
