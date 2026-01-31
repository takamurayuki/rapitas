// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

struct BackendState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(BackendState { child: None }))
        .setup(|app| {
            // バックエンドサイドカーを起動
            let shell = app.shell();

            // サイドカーコマンドを作成（SQLiteモードで起動）
            let sidecar = shell.sidecar("rapitas-backend")
                .expect("failed to create sidecar command")
                .env("RAPITAS_SQLITE", "true")
                .env("TAURI_BUILD", "true");

            // サイドカーを起動
            let (mut rx, child) = sidecar.spawn()
                .expect("failed to spawn sidecar");

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
            Ok(())
        })
        .on_window_event(|window, event| {
            // ウィンドウが閉じられたらバックエンドも停止
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state = app.state::<Mutex<BackendState>>();
                let mut guard = state.lock().unwrap();
                if let Some(child) = guard.child.take() {
                    let _ = child.kill();
                    println!("Backend sidecar stopped.");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
