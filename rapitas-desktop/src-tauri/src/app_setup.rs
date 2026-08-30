//! app_setup
//!
//! Application bootstrap: tray icon, global shortcut wiring, AUMID
//! registration and the unified tauri::Builder for both debug and release
//! profiles. Command implementations live in their own modules.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};

use crate::quick_capture::show_quick_capture_window;
use crate::shortcut_config::{
    load_capture_shortcut_config, load_shortcut_config, load_todo_shortcut_config,
    parse_shortcut_from_config,
};
use crate::shortcuts::reregister_all_shortcuts;
use crate::today_todo::show_today_todo_window;
use crate::window_commands::show_main_window;

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
                crate::terminal::kill_all(app);
                #[cfg(not(debug_assertions))]
                crate::release::kill_backend(app);
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
/// the foreground, Ctrl+Alt+I to open the quick idea-capture popup, Ctrl+Alt+T
/// to open today's suggested-todo popup).
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::ShortcutState;

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, event| {
                if event.state() == ShortcutState::Pressed {
                    // Re-read config on each press so runtime shortcut changes
                    // dispatch correctly without rebuilding this handler.
                    let capture = parse_shortcut_from_config(&load_capture_shortcut_config(app));
                    let todo = parse_shortcut_from_config(&load_todo_shortcut_config(app));
                    if capture == Some(*sc) {
                        println!("[Shortcut] Capture shortcut pressed - opening quick capture");
                        if let Err(e) = show_quick_capture_window(app) {
                            eprintln!("[Shortcut] {e}");
                        }
                    } else if todo == Some(*sc) {
                        println!("[Shortcut] Todo shortcut pressed - opening today's todo");
                        if let Err(e) = show_today_todo_window(app) {
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
        "Global shortcuts registered: {} (main), {} (capture), {} (todo)",
        load_shortcut_config(app.handle()),
        load_capture_shortcut_config(app.handle()),
        load_todo_shortcut_config(app.handle())
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

/// Build and run the Tauri application.
///
/// Single builder for both profiles; the release/debug differences are only
/// the three cfg-gated spots below (BackendState manage, setup_sidecar call,
/// dev-mode println) — everything else is shared verbatim.
pub fn run() {
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
         --disable-backgrounding-occluded-windows \
         --autoplay-policy=no-user-gesture-required",
    );
    // NOTE: autoplay-policy is required for the notification toast's chime —
    // the toast window plays it without any user gesture.

    #[cfg(debug_assertions)]
    println!("[Dev Mode] Skipping sidecar - backend started by dev.js");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init());

    // Release-only sidecar backend process state (difference #1 of 3).
    #[cfg(not(debug_assertions))]
    let builder = builder.manage(std::sync::Mutex::new(crate::release::BackendState {
        child: None,
    }));

    builder
        .manage(crate::terminal::TerminalManager::new())
        .manage(crate::toast::PendingToast {
            pending: std::sync::Mutex::new(None),
            ready: std::sync::atomic::AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            crate::shortcuts::get_global_shortcut,
            crate::shortcuts::set_global_shortcut,
            crate::shortcuts::get_capture_shortcut,
            crate::shortcuts::set_capture_shortcut,
            crate::quick_capture::open_quick_capture,
            crate::today_todo::open_today_todo,
            crate::toast::show_toast_window,
            crate::toast::toast_ready,
            crate::toast::toast_dismiss,
            crate::toast::toast_navigate,
            crate::browser::open_split_view,
            crate::browser::open_url_in_browser,
            crate::window_commands::get_window_decorations,
            crate::voice_commands::voice_model_status,
            crate::voice_commands::voice_start_recording,
            crate::voice_commands::voice_stop_recording,
            crate::voice_commands::wake_word_start,
            crate::voice_commands::wake_word_stop,
            crate::voice_commands::wake_word_status,
            crate::terminal::terminal_create,
            crate::terminal::terminal_write,
            crate::terminal::terminal_resize,
            crate::terminal::terminal_close
        ])
        .setup(|app| {
            // Release-only sidecar startup (difference #2 of 3).
            #[cfg(not(debug_assertions))]
            crate::release::setup_sidecar(app);
            #[cfg(target_os = "windows")]
            register_aumid_for_toasts(app);
            setup_tray(app)?;
            setup_global_shortcut(app)?;
            // Pre-warm the toast window while boot owns the focus anyway.
            if let Err(e) = crate::toast::create_toast_window(app.handle()) {
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
            // Native visibility signal for the frontend (useAppVisibility).
            // WebView2 occlusion is disabled to avoid a black-screen bug, so
            // document.visibilityState stays 'visible' even while minimized —
            // this event is the only reliable hidden signal. Only main is
            // relevant (quick-capture/notification-toast focus churn must not
            // affect it); Focused re-emits on restore, Resized carries the
            // is_minimized() transition since Tauri v2 has no Minimized/Restored
            // variant.
            if matches!(
                event,
                tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)
            ) && window.label() == "main"
            {
                let hidden = window.is_minimized().unwrap_or(false);
                let _ = window.emit_to(
                    "main",
                    "app://visibility",
                    serde_json::json!({ "hidden": hidden }),
                );
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
