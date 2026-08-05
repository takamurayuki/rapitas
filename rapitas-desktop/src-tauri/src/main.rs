// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(target_os = "windows")]
mod window_manager;

mod browser_launcher;

#[cfg(target_os = "windows")]
mod split_screen_manager;

mod voice_recognition;
mod wake_word;

mod terminal;

#[cfg(not(debug_assertions))]
mod release;

mod shortcut_config;
use shortcut_config::{
    load_capture_shortcut_config, load_shortcut_config, parse_shortcut_from_config,
    save_shortcut_key,
};

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

/// Re-register both global shortcuts (main + quick capture) from config.
/// unregister_all first so a stale registration never lingers; when both keys
/// are configured to the same combo it only registers once (main wins).
fn reregister_all_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {e}"))?;

    let main_sc = parse_shortcut_from_config(&load_shortcut_config(app));
    if let Some(sc) = main_sc {
        app.global_shortcut()
            .register(sc)
            .map_err(|e| format!("Failed to register shortcut: {e}"))?;
    }
    if let Some(sc) = parse_shortcut_from_config(&load_capture_shortcut_config(app)) {
        if main_sc != Some(sc) {
            app.global_shortcut()
                .register(sc)
                .map_err(|e| format!("Failed to register capture shortcut: {e}"))?;
        }
    }
    Ok(())
}

/// Tauri command: change the global (bring-to-foreground) shortcut and persist it.
#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    parse_shortcut_from_config(&shortcut).ok_or_else(|| format!("Invalid shortcut: {shortcut}"))?;
    save_shortcut_key(&app, "shortcut", &shortcut)?;
    reregister_all_shortcuts(&app)?;
    println!("[Shortcut] Global shortcut changed to: {shortcut}");
    Ok(shortcut)
}

/// Tauri command: get the current quick-capture shortcut configuration.
#[tauri::command]
fn get_capture_shortcut(app: tauri::AppHandle) -> String {
    load_capture_shortcut_config(&app)
}

/// Tauri command: change the quick-capture shortcut and persist it.
#[tauri::command]
fn set_capture_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    parse_shortcut_from_config(&shortcut).ok_or_else(|| format!("Invalid shortcut: {shortcut}"))?;
    save_shortcut_key(&app, "captureShortcut", &shortcut)?;
    reregister_all_shortcuts(&app)?;
    println!("[Shortcut] Capture shortcut changed to: {shortcut}");
    Ok(shortcut)
}

/// Show (or lazily create) the always-on-top quick idea-capture popup window.
///
/// # Errors
/// Returns a message when the webview window cannot be created.
fn show_quick_capture_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quick-capture") {
        // NOTE: no re-center on reuse — the user can drag the popup where they
        // want it, and it must reappear there, not snap back to the middle.
        let _ = win.show();
        let _ = win.set_focus();
        // Tell the page to clear its input for a fresh capture.
        let _ = win.emit("quick-capture:show", ());
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        "quick-capture",
        tauri::WebviewUrl::App("quick-capture".into()),
    )
    .title("Rapitas Quick Capture")
    // NOTE: keep in sync with WINDOW_WIDTH/HEIGHT in app/quick-capture/page.tsx
    // (the page also self-resizes so older binaries pick up layout changes).
    .inner_size(640.0, 320.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create quick-capture window: {e}"))?;
    let _ = win.set_focus();
    Ok(())
}

/// Tauri command: open the quick idea-capture popup (also used by the tray menu).
#[tauri::command]
fn open_quick_capture(app: tauri::AppHandle) -> Result<(), String> {
    show_quick_capture_window(&app)
}

// Keep in sync with the layout in app/notification-toast/page.tsx.
const TOAST_WIDTH: f64 = 380.0;
const TOAST_HEIGHT: f64 = 116.0;
const TOAST_MARGIN: f64 = 16.0;
const TOAST_TASKBAR_ALLOWANCE: f64 = 48.0; // approximate Windows taskbar height

/// Toast handoff state. `pending` buffers the latest payload while the toast
/// page is still loading (an emit would be lost before its listener exists);
/// `ready` flips once the page called toast_ready, after which payloads are
/// delivered by emit alone (buffering then would replay stale toasts if the
/// window were ever recreated).
struct PendingToast {
    pending: std::sync::Mutex<Option<serde_json::Value>>,
    ready: std::sync::atomic::AtomicBool,
}

/// Position the toast at the bottom-right of the primary monitor.
fn position_toast(win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let _ = win.set_position(tauri::LogicalPosition::new(
            size.width - TOAST_WIDTH - TOAST_MARGIN,
            size.height - TOAST_HEIGHT - TOAST_TASKBAR_ALLOWANCE - TOAST_MARGIN,
        ));
    }
}

/// "Dismiss" = move the toast far off-screen, keeping it visible to Windows.
/// hide()/show() cycles are unusable here: tao's show maps to SW_SHOW, which
/// ACTIVATES the window (stealing focus on every notification), and a
/// visible(false) WebView2 never finishes navigating in the first place.
fn park_toast(win: &tauri::WebviewWindow) {
    let _ = win.set_position(tauri::LogicalPosition::new(0.0, -10000.0));
}

/// Create the toast window parked far off-screen so its page can load out of
/// sight. Called once during app setup (pre-warm) — creating it lazily at
/// notification time would steal focus mid-typing, but at boot the app owns
/// focus anyway. The page calls toast_ready when mounted; with no pending
/// payload the window simply hides until the first notification.
///
/// NOTE: build flags are deliberately minimal. focused(false) — with or
/// without focusable(false)/visible(false) — leaves the WebView2 permanently
/// stuck at about:blank (navigation never starts), so the window is created
/// plain and focus avoidance comes from pre-warming + show()-without-set_focus.
fn create_toast_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("notification-toast").is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "notification-toast",
        tauri::WebviewUrl::App("notification-toast".into()),
    )
    .title("Rapitas Notification")
    .inner_size(TOAST_WIDTH, TOAST_HEIGHT)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .position(0.0, -10000.0)
    .build()
    .map_err(|e| format!("Failed to create toast window: {e}"))?;
    Ok(())
}

/// Tauri command: show the app's own global toast window (bottom-right,
/// always-on-top). Used instead of Windows toast notifications, which are
/// silently droppable by OS settings/focus assist.
///
/// The payload goes through the PendingToast slot AND an emit — the slot
/// covers a page still loading (it pulls via toast_ready), the emit covers the
/// common case of the pre-warmed page already listening.
/// NOTE: the payload must NOT travel in the URL — WebviewUrl::App takes a
/// PathBuf, and a query string is an invalid Windows path (the window then
/// sticks at about:blank).
#[tauri::command]
fn show_toast_window(
    app: tauri::AppHandle,
    title: String,
    body: String,
    link: Option<String>,
) -> Result<(), String> {
    let payload = serde_json::json!({ "title": title, "body": body, "link": link });
    let ready = app
        .try_state::<PendingToast>()
        .map(|s| s.ready.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false);
    if !ready {
        if let Some(state) = app.try_state::<PendingToast>() {
            *state.pending.lock().unwrap() = Some(payload.clone());
        }
    }

    if let Some(win) = app.get_webview_window("notification-toast") {
        if ready {
            // Moving into place never activates the window — no focus steal.
            position_toast(&win);
            let _ = win.emit("rapitas:toast", payload);
        }
        // Not ready: the page is still loading and will pull the pending
        // payload (and move into place) via toast_ready.
        return Ok(());
    }
    // Pre-warm missing (e.g. it failed at boot) — recreate; the page will pull
    // the pending payload via toast_ready when it finishes loading.
    create_toast_window(&app)
}

/// Tauri command: the toast page finished mounting. With a pending payload,
/// move the window into place and show it; without one (boot pre-warm) just
/// park it hidden until the first notification.
#[tauri::command]
fn toast_ready(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let payload = app.try_state::<PendingToast>().and_then(|s| {
        s.ready.store(true, std::sync::atomic::Ordering::SeqCst);
        s.pending.lock().unwrap().take()
    });
    if let Some(win) = app.get_webview_window("notification-toast") {
        if payload.is_some() {
            position_toast(&win);
        } else {
            park_toast(&win);
        }
    }
    payload
}

/// Tauri command: dismiss the toast (auto-hide timer or the × button).
#[tauri::command]
fn toast_dismiss(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("notification-toast") {
        park_toast(&win);
    }
}

/// Tauri command: the toast body was clicked — hide the toast, bring the main
/// window forward, and let its router navigate to the notification's link.
#[tauri::command]
fn toast_navigate(app: tauri::AppHandle, link: Option<String>) {
    if let Some(win) = app.get_webview_window("notification-toast") {
        park_toast(&win);
    }
    show_main_window(&app);
    if let Some(l) = link {
        // emit_to, NOT a broadcast emit — the toast window itself also mounts
        // the app layout, and a broadcast would make ITS router navigate,
        // turning the tiny toast into a miniature copy of the app.
        let _ = app.emit_to("main", "rapitas:toast-navigate", l);
    }
}

/// Tauri command: open a URL in split-screen view using the chosen (App
/// Settings) or native browser. `browser` is a preset key (chrome/msedge/firefox).
#[tauri::command]
async fn open_split_view(
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
        split_screen_manager::split_screen_with_browser(
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
async fn open_url_in_browser(url: String, browser: String) -> Result<(), String> {
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
        match browser_launcher::browser_path_for_preset(&browser) {
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
        // NOTE: visibilitychange is unreliable when Tauri hides/shows a window
        // via ShowWindow(). Emit a custom event so the frontend SSE manager can
        // pause/resume reliably without depending on the browser visibility API.
        let _ = window.emit("rapitas:window-show", ());
    }
}

/// Set up the system tray icon and menu.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let capture_item = MenuItem::with_id(app, "capture", "Quick Capture", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &capture_item, &quit_item])?;

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
            "capture" => {
                if let Err(e) = show_quick_capture_window(app) {
                    eprintln!("[Tray] {e}");
                }
            }
            "quit" => {
                // Kill all integrated-terminal PTYs so no shell (and its
                // children) is orphaned when the app exits.
                terminal::kill_all(app);
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

/// Set up the global shortcuts (defaults: Ctrl+Alt+R to bring the window to
/// the foreground, Ctrl+Alt+I to open the quick idea-capture popup).
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::ShortcutState;

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, event| {
                if event.state() == ShortcutState::Pressed {
                    // Re-read config on each press so runtime shortcut changes
                    // dispatch correctly without rebuilding this handler.
                    let capture = parse_shortcut_from_config(&load_capture_shortcut_config(app));
                    if capture == Some(*sc) {
                        println!("[Shortcut] Capture shortcut pressed - opening quick capture");
                        if let Err(e) = show_quick_capture_window(app) {
                            eprintln!("[Shortcut] {e}");
                        }
                    } else {
                        println!("[Shortcut] Global shortcut pressed - showing main window");
                        show_main_window(app);
                    }
                }
            })
            .build(),
    )?;

    // unregister_all inside also clears any stale registration from a previous crash
    reregister_all_shortcuts(app.handle()).map_err(std::io::Error::other)?;
    println!(
        "Global shortcuts registered: {} (main), {} (capture)",
        load_shortcut_config(app.handle()),
        load_capture_shortcut_config(app.handle())
    );

    Ok(())
}

/// Register the app's AppUserModelID for toast notifications.
///
/// Windows silently drops WinRT toasts whose AUMID is not registered.
/// Installed builds get the registration from the installer's Start-menu
/// shortcut, but dev/portable runs have no installer — without this HKCU
/// entry, tauri-plugin-notification's sendNotification resolves successfully
/// yet nothing ever appears on screen.
#[cfg(target_os = "windows")]
fn register_aumid_for_toasts(app: &tauri::App) {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let identifier = app.config().identifier.clone();
    let path = format!("Software\\Classes\\AppUserModelId\\{identifier}");
    match RegKey::predef(HKEY_CURRENT_USER).create_subkey(&path) {
        Ok((key, _)) => {
            let _ = key.set_value("DisplayName", &"Rapitas");
            println!("[Notifications] AppUserModelID registered: {identifier}");
        }
        Err(e) => eprintln!("[Notifications] AUMID registration failed: {e}"),
    }
}

fn main() {
    // Keep WebView2 painting and responsive when the window is occluded or
    // backgrounded (e.g. split-screen layout with another app on top).
    // - CalculateNativeWinOcclusion: prevents Chromium from pausing rendering
    //   (black frame) when the window is occluded by another window.
    // WebView2 flags (must be set before any webview is created):
    // - CalculateNativeWinOcclusion: prevents the renderer from pausing when
    //   the window is covered by another window — fixes black-screen on refocus.
    // - disable-renderer-backgrounding: prevents the renderer process from being
    //   deprioritised (throttled CPU / suspended) when the window loses focus.
    // - disable-background-timer-throttling: keeps JS timers and rAF running at
    //   full rate when the window is in background, preventing UI freeze on refocus.
    // - disable-backgrounding-occluded-windows: keeps the compositor alive even
    //   when the window is fully occluded, eliminating the black-frame artifact
    //   that appears when the window is brought back to the foreground.
    #[cfg(target_os = "windows")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-features=CalculateNativeWinOcclusion \
         --disable-renderer-backgrounding \
         --disable-background-timer-throttling \
         --disable-backgrounding-occluded-windows",
    );

    #[cfg(not(debug_assertions))]
    {
        use std::sync::Mutex;
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_notification::init())
            .manage(Mutex::new(release::BackendState { child: None }))
            .manage(terminal::TerminalManager::new())
            .manage(PendingToast {
                pending: std::sync::Mutex::new(None),
                ready: std::sync::atomic::AtomicBool::new(false),
            })
            .invoke_handler(tauri::generate_handler![
                get_global_shortcut,
                set_global_shortcut,
                get_capture_shortcut,
                set_capture_shortcut,
                open_quick_capture,
                show_toast_window,
                toast_ready,
                toast_dismiss,
                toast_navigate,
                open_split_view,
                open_url_in_browser,
                get_window_decorations,
                voice_model_status,
                voice_start_recording,
                voice_stop_recording,
                wake_word_start,
                wake_word_stop,
                wake_word_status,
                terminal::terminal_create,
                terminal::terminal_write,
                terminal::terminal_resize,
                terminal::terminal_close
            ])
            .setup(|app| {
                release::setup_sidecar(app);
                #[cfg(target_os = "windows")]
                register_aumid_for_toasts(app);
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                // Pre-warm the toast window while boot owns the focus anyway.
                if let Err(e) = create_toast_window(app.handle()) {
                    eprintln!("[Toast] pre-warm failed: {e}");
                }
                Ok(())
            })
            .on_window_event(|window, event| {
                // Hide window to system tray instead of closing
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("rapitas:window-hide", ());
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
            .plugin(tauri_plugin_notification::init())
            .manage(terminal::TerminalManager::new())
            .manage(PendingToast {
                pending: std::sync::Mutex::new(None),
                ready: std::sync::atomic::AtomicBool::new(false),
            })
            .invoke_handler(tauri::generate_handler![
                get_global_shortcut,
                set_global_shortcut,
                get_capture_shortcut,
                set_capture_shortcut,
                open_quick_capture,
                show_toast_window,
                toast_ready,
                toast_dismiss,
                toast_navigate,
                open_split_view,
                open_url_in_browser,
                get_window_decorations,
                voice_model_status,
                voice_start_recording,
                voice_stop_recording,
                wake_word_start,
                wake_word_stop,
                wake_word_status,
                terminal::terminal_create,
                terminal::terminal_write,
                terminal::terminal_resize,
                terminal::terminal_close
            ])
            .setup(|app| {
                #[cfg(target_os = "windows")]
                register_aumid_for_toasts(app);
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                // Pre-warm the toast window while boot owns the focus anyway.
                if let Err(e) = create_toast_window(app.handle()) {
                    eprintln!("[Toast] pre-warm failed: {e}");
                }
                Ok(())
            })
            .on_window_event(|window, event| {
                // Hide window to system tray instead of closing
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("rapitas:window-hide", ());
                    println!("[Tray] Window hidden to system tray");
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
