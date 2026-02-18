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

        // サイドカーコマンドを作成（PostgreSQLモードで起動）
        let sidecar = shell
            .sidecar("rapitas-backend")
            .expect("failed to create sidecar command")
            .env("TAURI_BUILD", "true");

        // サイドカーを起動
        let (mut rx, child) = sidecar.spawn().expect("failed to spawn sidecar");

        // 状態にchildを保存（後でクリーンアップ用）
        let state = app.state::<Mutex<BackendState>>();
        state.lock().unwrap().child = Some(child);

        // バックエンドの出力をログに記録
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

        println!("Backend sidecar started successfully!");
    }

    pub fn kill_backend(app: &tauri::AppHandle) {
        let state = app.state::<Mutex<BackendState>>();
        let mut guard = state.lock().unwrap();
        if let Some(child) = guard.child.take() {
            let _ = child.kill();
            println!("Backend sidecar stopped.");
        }
    }
}

use std::path::PathBuf;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+R";

/// ショートカット設定ファイルのパスを取得
fn shortcut_config_path(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_config_dir()
        .expect("failed to get app config dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("shortcut.json")
}

/// 保存された設定からショートカット文字列を読み込み
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

/// 文字列ショートカットをパースして Shortcut に変換
fn parse_shortcut_from_config(
    config: &str,
) -> Option<tauri_plugin_global_shortcut::Shortcut> {
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

/// Tauriコマンド: ウィンドウの装飾情報を取得
#[tauri::command]
fn get_window_decorations(window: tauri::Window) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use serde_json::json;

        // Windowsの標準タイトルバーの高さ（DPI考慮なし）
        let title_bar_height = 32;

        // 実際のDPIを考慮した高さの計算も可能
        // ただし、ここではシンプルに固定値を返す
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

// Tauriコマンド: 現在のショートカット設定を取得
#[tauri::command]
fn get_global_shortcut(app: tauri::AppHandle) -> String {
    load_shortcut_config(&app)
}

/// Tauriコマンド: グローバルショートカットを変更して保存
#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // パースの検証
    let new_shortcut = parse_shortcut_from_config(&shortcut)
        .ok_or_else(|| format!("無効なショートカット: {}", shortcut))?;

    // 既存のすべてのショートカットを解除
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("ショートカットの解除に失敗: {}", e))?;

    // 新しいショートカットを登録
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("ショートカットの登録に失敗: {}", e))?;

    // 設定ファイルに保存
    let path = shortcut_config_path(&app);
    let json = serde_json::json!({ "shortcut": shortcut });
    std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("設定の保存に失敗: {}", e))?;

    println!("[Shortcut] Global shortcut changed to: {}", shortcut);
    Ok(shortcut)
}

/// Tauriコマンド: 画面分割表示でURLを開く（ネイティブブラウザを使用）
#[tauri::command]
async fn open_split_view(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("モニター取得失敗: {}", e))?
        .ok_or("モニターが見つかりません")?;

    let screen_size = monitor.size();
    let screen_width = screen_size.width as i32;
    let screen_height = screen_size.height as i32;

    // Windows環境で統合された画面分割処理を使用
    #[cfg(target_os = "windows")]
    {
        split_screen_manager::split_screen_with_browser(&url, screen_width, screen_height)?;
    }

    // 他のOS環境では既存の方法を使用
    #[cfg(not(target_os = "windows"))]
    {
        // メインウィンドウを右半分に移動
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.unmaximize().ok();
            main_window
                .set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition {
                        x: (screen_width / 2) as i32,
                        y: 0,
                    }
                ))
                .ok();
            main_window
                .set_size(tauri::Size::Physical(
                    tauri::PhysicalSize {
                        width: (screen_width / 2) as u32,
                        height: screen_height as u32,
                    }
                ))
                .ok();
            main_window.show().ok();
        }

        // ブラウザでURLを開く
        open::that(&url).map_err(|e| format!("ブラウザ起動失敗: {}", e))?;

        // フォーカスを戻す
        std::thread::sleep(std::time::Duration::from_millis(1000));
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.set_focus().ok();
        }
    }

    Ok(())
}

/// メインウィンドウを表示してフォーカスする
/// Windows では hide → show → unminimize → set_focus の順序で呼ぶ必要がある
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Windows で確実に最前面に表示するため、一旦 hide してから show する
        let _ = window.hide();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// システムトレイをセットアップする
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "ウィンドウを表示", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let tray_icon_bytes = include_bytes!("../icons/32x32.png");
    let tray_icon_image = tauri::image::Image::from_bytes(tray_icon_bytes)
        .expect("failed to load tray icon");

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

/// グローバルショートカットをセットアップする (Ctrl+Alt+R でウィンドウを最前面に表示)
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    // 保存された設定からショートカットを読み込み、なければデフォルト (Ctrl+Alt+R)
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

    // 前回のクラッシュ等でOSに残っている場合に備え、先にunregisterする
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
            .invoke_handler(tauri::generate_handler![get_global_shortcut, set_global_shortcut, open_split_view, get_window_decorations])
            .setup(|app| {
                release::setup_sidecar(app);
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                // 閉じるボタンでウィンドウを隠す（トレイに格納）
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
            .invoke_handler(tauri::generate_handler![get_global_shortcut, set_global_shortcut, open_split_view, get_window_decorations])
            .setup(|app| {
                setup_tray(app)?;
                setup_global_shortcut(app)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                // 閉じるボタンでウィンドウを隠す（トレイに格納）
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
