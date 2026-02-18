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
    let binaries_dir = PathBuf::from("binaries");

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

        // Check if binaries directory exists
        if !binaries_dir.exists() {
            println!("cargo:warning=  binaries/ directory does not exist");
            // In CI, this is expected during the initial Rust check phase
            // The backend binary will be built later in the workflow
            if env::var("CI").is_ok() {
                println!("cargo:warning=  Running in CI environment - binary will be built later");
            }
        } else if let Ok(entries) = fs::read_dir(&binaries_dir) {
            let mut found_any = false;
            for entry in entries.flatten() {
                found_any = true;
                println!(
                    "cargo:warning=  Found: {}",
                    entry.file_name().to_string_lossy()
                );
            }
            if !found_any {
                println!("cargo:warning=  binaries/ directory is empty");
            }
        }

        // In CI environment, check if we're in the Rust check phase
        // where the binary hasn't been built yet
        if env::var("CI").is_ok() && env::var("RUST_CHECK_ONLY").is_ok() {
            println!("cargo:warning=  Rust check phase - skipping binary requirement");
        }
    }

    // Try to find any binaries using glob pattern
    // This is to provide more helpful debugging info
    if !found && binaries_dir.exists() {
        // List all files that start with "rapitas-backend"
        if let Ok(entries) = fs::read_dir(&binaries_dir) {
            println!("cargo:warning=  Looking for files matching rapitas-backend*:");
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let file_name_str = file_name.to_string_lossy();
                if file_name_str.starts_with("rapitas-backend") {
                    println!("cargo:warning=    Found matching file: {}", file_name_str);
                }
            }
        }
    }

    // In CI environment, if binary is not found, set a placeholder path
    // This allows the build to proceed, and the actual binary will be
    // handled by the prepare-backend-binary.js script
    if !found && env::var("CI").is_ok() {
        println!("cargo:warning=CI environment detected with missing binary - setting placeholder");
        // Use platform-specific placeholder name to match what prepare-backend-binary.js creates
        let placeholder_name = if target_os == "windows" {
            "binaries/rapitas-backend-placeholder.exe"
        } else {
            "binaries/rapitas-backend-placeholder"
        };
        println!("cargo:rustc-env=RAPITAS_BACKEND_PATH={}", placeholder_name);
    }

    tauri_build::build()
}
