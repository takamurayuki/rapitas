use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Copy backend binary to resources
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    // Construct the expected binary name based on target
    let binary_name = match target_os.as_str() {
        "windows" => format!(
            "rapitas-backend-{}-pc-windows-{}.exe",
            target_arch, target_env
        ),
        "macos" => format!("rapitas-backend-{}-apple-darwin", target_arch),
        "linux" => format!("rapitas-backend-{}-unknown-linux-gnu", target_arch),
        _ => panic!("Unsupported target OS: {}", target_os),
    };

    let source_path = PathBuf::from("binaries").join(&binary_name);

    // In CI/CD, the binary might not have the full target triple in the name
    // Try alternative names if the primary one doesn't exist
    let alt_binary_name = format!(
        "rapitas-backend-{}-{}-{}",
        target_arch, target_os, target_env
    );
    let alternative_names: Vec<&str> = match target_os.as_str() {
        "windows" => vec![
            "rapitas-backend.exe",
            "rapitas-backend-x86_64-pc-windows-msvc.exe",
        ],
        _ => vec!["rapitas-backend", &alt_binary_name],
    };

    let mut found = false;

    // First try the primary name
    if source_path.exists() {
        println!(
            "cargo:rustc-env=RAPITAS_BACKEND_PATH={}",
            source_path.display()
        );
        found = true;
    } else {
        // Try alternative names
        for alt_name in alternative_names {
            let alt_path = PathBuf::from("binaries").join(alt_name);
            if alt_path.exists() {
                println!(
                    "cargo:rustc-env=RAPITAS_BACKEND_PATH={}",
                    alt_path.display()
                );
                found = true;
                break;
            }
        }
    }

    if !found {
        // In CI/CD builds, we might not have the binary yet
        // This is expected for the initial Rust check phase
        println!(
            "cargo:warning=Backend binary not found at: {}",
            source_path.display()
        );
        println!("cargo:warning=Looked for alternatives in: binaries/");
        if let Ok(entries) = fs::read_dir("binaries") {
            for entry in entries.flatten() {
                println!(
                    "cargo:warning=  Found: {}",
                    entry.file_name().to_string_lossy()
                );
            }
        }
    }

    tauri_build::build()
}
