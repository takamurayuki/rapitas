// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

    pub fn handle_window_close(window: &tauri::Window) {
        let app = window.app_handle();
        let state = app.state::<Mutex<BackendState>>();
        let mut guard = state.lock().unwrap();
        if let Some(child) = guard.child.take() {
            let _ = child.kill();
            println!("Backend sidecar stopped.");
        }
    }
}

fn main() {
    #[cfg(not(debug_assertions))]
    {
        use std::sync::Mutex;
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .manage(Mutex::new(release::BackendState { child: None }))
            .setup(|app| {
                release::setup_sidecar(app);
                Ok(())
            })
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    release::handle_window_close(window);
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
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
