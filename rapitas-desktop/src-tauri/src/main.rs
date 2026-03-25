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
mod release {
    use std::sync::Mutex;
    use tauri::Manager;
    use tauri_plugin_shell::ShellExt;

    pub struct BackendState {
        pub child: Option<tauri_plugin_shell::process::CommandChild>,
    }

    pub fn setup_sidecar(app: &tauri::App) {
        let shell = app.shell();

        let backend_filename = if cfg!(target_os = "windows") {
            "rapitas-backend.exe"
        } else if cfg!(target_os = "macos") {
            "rapitas-backend"
        } else {
            "rapitas-backend"
        };

        // Dev mode: src-tauri/binaries/rapitas-backend-*.exe
        // Release mode: $INSTDIR/binaries/rapitas-backend-*.exe
        let resource_path = {
            let dev_resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir")
                .join("binaries");

            println!("[Backend] Checking dev resources: {:?}", dev_resource_dir);

            let mut backend_path = None;

            if dev_resource_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&dev_resource_dir) {
                    backend_path = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .find(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .map(|n| n.starts_with("rapitas-backend") && n.ends_with(if cfg!(windows) { ".exe" } else { "" }))
                                .unwrap_or(false)
                        });
                }
            }

            // Release mode: check the binaries subdirectory next to the app executable
            if backend_path.is_none() {
                let app_dir = std::env::current_exe()
                    .expect("failed to get current exe path")
                    .parent()
                    .expect("failed to get parent dir")
                    .to_path_buf();

                let release_binaries_dir = app_dir.join("binaries");
                println!("[Backend] Checking release binaries: {:?}", release_binaries_dir);

                if release_binaries_dir.exists() {
                    if let Ok(entries) = std::fs::read_dir(&release_binaries_dir) {
                        backend_path = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.path())
                            .find(|p| {
                                p.file_name()
                                    .and_then(|n| n.to_str())
                                    .map(|n| n.starts_with("rapitas-backend") && n.ends_with(if cfg!(windows) { ".exe" } else { "" }))
                                    .unwrap_or(false)
                            });
                    }
                }
            }

            backend_path.expect("Backend executable not found in resources or app directory")
        };

        println!("[Backend] Found backend: {:?}", resource_path);

        // Copy backend to app data directory
        let app_data_dir = app
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        std::fs::create_dir_all(&app_data_dir).ok();

        let backend_path = app_data_dir.join(backend_filename);

        // Copy resource (overwrite on update)
        std::fs::copy(&resource_path, &backend_path)
            .expect("failed to copy backend executable");
        println!("[Backend] Copied to: {:?}", backend_path);

        // Launch the backend process
        let backend_command = shell
            .command(backend_path.to_string_lossy().to_string())
            .env("TAURI_BUILD", "true");

        let (mut rx, child) = backend_command.spawn().expect("failed to spawn backend");

        // Store child process handle for cleanup on exit
        let state = app.state::<Mutex<BackendState>>();
        state.lock().unwrap().child = Some(child);

        // Forward backend output to logs
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        println!("[Backend] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("[Backend Error] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[Backend] Error: {}", err);
                    }
                    CommandEvent::Terminated(payload) => {
                        println!("[Backend] Terminated with code: {:?}", payload.code);
                    }
                    _ => {}
                }
            }
        });

        println!("Backend started successfully!");
    }

    pub fn kill_backend(app: &tauri::AppHandle) {
        let state = app.state::<Mutex<BackendState>>();
        let mut guard = state.lock().unwrap();
        if let Some(child) = guard.child.take() {
            let _ = child.kill();
            println!("Backend stopped.");
        }
    }
}

use std::path::PathBuf;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+R";

/// Get the path to the shortcut configuration file.
fn shortcut_config_path(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_config_dir()
        .expect("failed to get app config dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("shortcut.json")
}

/// Load the shortcut string from saved configuration.
fn load_shortcut_config(app: &tauri::AppHandle) -> String {
    let path = shortcut_config_path(app);
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(s) = val["shortcut"].as_str() {
                return s.to_string();
            }
        }
    }
    DEFAULT_SHORTCUT.to_string()
}

/// Parse a shortcut string and convert it to a Shortcut instance.
fn parse_shortcut_from_config(config: &str) -> Option<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    let parts: Vec<&str> = config.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return None;
    }

    let mut modifiers = Modifiers::empty();
    let key_str = parts.last()?;

    for &part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" | "win" | "cmd" => modifiers |= Modifiers::SUPER,
            _ => {}
        }
    }

    let code = match key_str.to_uppercase().as_str() {
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        "SPACE" => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "ESCAPE" | "ESC" => Code::Escape,
        "TAB" => Code::Tab,
        _ => return None,
    };

    let mods = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };

    Some(Shortcut::new(mods, code))
}

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
        .ok_or_else(|| format!("Invalid shortcut: {}", shortcut))?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {}", e))?;

    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    let path = shortcut_config_path(&app);
    let json = serde_json::json!({ "shortcut": shortcut });
    std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to save config: {}", e))?;

    println!("[Shortcut] Global shortcut changed to: {}", shortcut);
    Ok(shortcut)
}

/// Tauri command: open a URL in split-screen view using the native browser.
#[tauri::command]
async fn open_split_view(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {}", e))?
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
                    x: (screen_width / 2) as i32,
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

        open::that(&url).map_err(|e| format!("Failed to launch browser: {}", e))?;

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
    let wav_path = tokio::task::spawn_blocking(|| voice_recognition::capture_audio())
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
    println!("Global shortcut registered: {}", shortcut_config);

    Ok(())
}

fn main() {
    #[cfg(not(debug_assertions))]
    {
        use std::sync::Mutex;
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
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
