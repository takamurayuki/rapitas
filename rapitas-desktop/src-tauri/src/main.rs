// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg(target_os = "windows")]
mod window_manager;

mod browser_launcher;

#[cfg(target_os = "windows")]
mod split_screen_manager;

mod voice_recognition;
mod wake_word;

#[cfg(not(debug_assertions))]
mod release;

mod shortcut_config;
use shortcut_config::{load_shortcut_config, parse_shortcut_from_config, shortcut_config_path};

/// Tauri command: get window decoration info.
#[tauri::command]
fn get_window_decorations(window: tauri::Window) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use serde_json::json;

        // NOTE: Fixed value without DPI scaling; sufficient for current use case
        let title_bar_height = 32;
        Ok(json!({
            "titleBarHeight": title_bar_height,
            "hasDecorations": window.is_decorated().unwrap_or(true),
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        use serde_json::json;
        Ok(json!({
            "titleBarHeight": 0,
            "hasDecorations": window.is_decorated().unwrap_or(true),
        }))
    }
}

/// Tauri command: get the current shortcut configuration.
#[tauri::command]
fn get_global_shortcut(app: tauri::AppHandle) -> String {
    load_shortcut_config(&app)
}

/// Tauri command: change the global shortcut and persist it.
#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let new_shortcut = parse_shortcut_from_config(&shortcut)
        .ok_or_else(|| format!("Invalid shortcut: {shortcut}"))?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {e}"))?;

    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("Failed to register shortcut: {e}"))?;

    let path = shortcut_config_path(&app);
    let json = serde_json::json!({ "shortcut": shortcut });
    std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to save config: {e}"))?;

    println!("[Shortcut] Global shortcut changed to: {shortcut}");
    Ok(shortcut)
}

/// Tauri command: open a URL in split-screen view using the native browser.
#[tauri::command]
async fn open_split_view(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {e}"))?
        .ok_or("No monitor found")?;

    let screen_size = monitor.size();
    let screen_width = screen_size.width as i32;
    let screen_height = screen_size.height as i32;

    #[cfg(target_os = "windows")]
    {
        split_screen_manager::split_screen_with_browser(&url, screen_width, screen_height)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
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

// --- Voice Recognition Commands ---

/// Check if the Whisper model is downloaded.
#[tauri::command]
fn voice_model_status() -> serde_json::Value {
    serde_json::json!({
        "downloaded": voice_recognition::is_model_downloaded(),
        "recording": voice_recognition::is_recording(),
    })
}

/// Start audio recording, then transcribe when stopped.
#[tauri::command]
async fn voice_start_recording() -> Result<String, String> {
    voice_recognition::start_recording()?;

    // Run audio capture in a blocking thread (cpal requires it)
    let wav_path = tokio::task::spawn_blocking(voice_recognition::capture_audio)
        .await
        .map_err(|e| format!("Recording task failed: {e}"))??;

    // Transcribe the captured WAV using whisper.cpp subprocess
    let result = voice_recognition::transcribe(&wav_path, "ja")?;
    Ok(result.text)
}

/// Stop the current recording session.
#[tauri::command]
fn voice_stop_recording() {
    voice_recognition::stop_recording();
}

/// Start wake word detection in the background.
/// Monitors the microphone for "ラピタス" and brings the window to the foreground.
#[tauri::command]
fn wake_word_start(app: tauri::AppHandle) {
    wake_word::start(app);
}

/// Stop wake word detection.
#[tauri::command]
fn wake_word_stop() {
    wake_word::stop();
}

/// Check if wake word detection is active.
#[tauri::command]
fn wake_word_status() -> bool {
    wake_word::is_active()
}

/// Show and focus the main window.
///
/// On Windows, the hide -> show -> unminimize -> set_focus sequence is required
/// to reliably bring the window to the foreground.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Set up the system tray icon and menu.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let tray_icon_bytes = include_bytes!("../icons/32x32.png");
    let tray_icon_image =
        tauri::image::Image::from_bytes(tray_icon_bytes).expect("failed to load tray icon");

    let _tray = TrayIconBuilder::new()
        .icon(tray_icon_image)
        .tooltip("Rapitas - AI Task Manager")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_main_window(app);
            }
            "quit" => {
                #[cfg(not(debug_assertions))]
                release::kill_backend(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Set up the global shortcut (default: Ctrl+Alt+R to bring window to foreground).
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    // Load saved shortcut config, falling back to default (Ctrl+Alt+R)
    let shortcut_config = load_shortcut_config(app.handle());
    let shortcut = parse_shortcut_from_config(&shortcut_config)
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR));

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, _sc, event| {
                if event.state() == ShortcutState::Pressed {
                    println!("[Shortcut] Global shortcut pressed - showing main window");
                    show_main_window(app);
                }
            })
            .build(),
    )?;

    // Unregister first in case the OS still holds a stale registration from a previous crash
    let _ = app.global_shortcut().unregister(shortcut);
    app.global_shortcut().register(shortcut)?;
    println!("Global shortcut registered: {shortcut_config}");

    Ok(())
}

fn main() {
    #[cfg(not(debug_assertions))]
    {
        use std::sync::Mutex;
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .manage(Mutex::new(release::BackendState { child: None }))
            .invoke_handler(tauri::generate_handler![
                get_global_shortcut,
                set_global_shortcut,
                open_split_view,
                get_window_decorations,
                voice_model_status,
                voice_start_recording,
                voice_stop_recording,
                wake_word_start,
                wake_word_stop,
                wake_word_status
            ])
            .setup(|app| {
                release::setup_sidecar(app);
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                // Hide window to system tray instead of closing
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    println!("[Tray] Window hidden to system tray");
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(debug_assertions)]
    {
        println!("[Dev Mode] Skipping sidecar - backend started by dev.js");
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .invoke_handler(tauri::generate_handler![
                get_global_shortcut,
                set_global_shortcut,
                open_split_view,
                get_window_decorations,
                voice_model_status,
                voice_start_recording,
                voice_stop_recording,
                wake_word_start,
                wake_word_stop,
                wake_word_status
            ])
            .setup(|app| {
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                // Hide window to system tray instead of closing
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    println!("[Tray] Window hidden to system tray");
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
