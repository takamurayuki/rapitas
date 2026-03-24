//! Voice Recognition Module
//!
//! Captures audio from the default input device using cpal, saves as WAV,
//! then transcribes via whisper.cpp CLI (pre-built binary, no LLVM needed).
//! Fully offline — no API keys or network required.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Result returned to the frontend via Tauri IPC.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
}

/// Shared state for controlling the recording session.
static RECORDING: AtomicBool = AtomicBool::new(false);

/// Get user home directory (cross-platform).
fn home_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

/// Base directory for rapitas models and binaries.
fn rapitas_dir() -> PathBuf {
    home_dir().join(".rapitas")
}

/// Path to the Whisper GGML model file.
fn get_model_path() -> PathBuf {
    rapitas_dir().join("models").join("ggml-tiny.bin")
}

/// Path to the whisper.cpp main binary.
fn get_whisper_binary_path() -> PathBuf {
    #[cfg(windows)]
    {
        rapitas_dir().join("bin").join("main.exe")
    }
    #[cfg(not(windows))]
    {
        rapitas_dir().join("bin").join("main")
    }
}

/// Check if the Whisper model is downloaded.
pub fn is_model_downloaded() -> bool {
    let model = get_model_path();
    let binary = get_whisper_binary_path();
    model.exists()
        && model.metadata().map(|m| m.len() > 1_000_000).unwrap_or(false)
        && binary.exists()
}

/// Check if currently recording.
pub fn is_recording() -> bool {
    RECORDING.load(Ordering::SeqCst)
}

/// Start recording audio from the default input device.
pub fn start_recording() -> Result<(), String> {
    if RECORDING.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }
    RECORDING.store(true, Ordering::SeqCst);
    Ok(())
}

/// Stop recording.
pub fn stop_recording() {
    RECORDING.store(false, Ordering::SeqCst);
}

/// Capture audio from the default input device until RECORDING flag is cleared.
/// Saves to a temporary WAV file and returns its path.
pub fn capture_audio() -> Result<PathBuf, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("マイクが見つかりません。接続を確認してください。")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("入力設定の取得に失敗: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let samples_clone = samples.clone();

    let err_fn = |err: cpal::StreamError| {
        eprintln!("[voice] Audio stream error: {err}");
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut buf = samples_clone.lock().unwrap();
                for chunk in data.chunks(channels) {
                    let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                    buf.push(mono);
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let mut buf = samples_clone.lock().unwrap();
                for chunk in data.chunks(channels) {
                    let mono: f32 =
                        chunk.iter().map(|&s| s as f32 / i16::MAX as f32).sum::<f32>()
                            / channels as f32;
                    buf.push(mono);
                }
            },
            err_fn,
            None,
        ),
        format => return Err(format!("未対応のサンプル形式: {format:?}")),
    }
    .map_err(|e| format!("入力ストリームの作成に失敗: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("録音の開始に失敗: {e}"))?;

    // Record until RECORDING flag is cleared
    while RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    drop(stream);

    let raw_samples = samples.lock().unwrap().clone();

    // Resample to 16kHz mono (whisper.cpp requirement)
    let pcm_16k = if sample_rate == 16000 {
        raw_samples
    } else {
        resample(&raw_samples, sample_rate, 16000)
    };

    // Write to temporary WAV file
    let wav_path = rapitas_dir().join("data").join("voice-input.wav");
    if let Some(parent) = wav_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("ディレクトリ作成に失敗: {e}"))?;
    }

    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer =
        WavWriter::create(&wav_path, spec).map_err(|e| format!("WAV書き込み失敗: {e}"))?;

    for &sample in &pcm_16k {
        let s16 = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer.write_sample(s16).map_err(|e| format!("サンプル書き込み失敗: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("WAVファイナライズ失敗: {e}"))?;

    Ok(wav_path)
}

/// Transcribe a WAV file using whisper.cpp CLI subprocess.
pub fn transcribe(wav_path: &PathBuf, language: &str) -> Result<TranscriptionResult, String> {
    let binary = get_whisper_binary_path();
    let model = get_model_path();

    if !binary.exists() {
        return Err("whisper.cppバイナリが見つかりません。設定からダウンロードしてください。".to_string());
    }
    if !model.exists() {
        return Err("Whisperモデルが見つかりません。設定からダウンロードしてください。".to_string());
    }

    let start = std::time::Instant::now();

    let output = Command::new(&binary)
        .args([
            "-m",
            model.to_str().unwrap(),
            "-f",
            wav_path.to_str().unwrap(),
            "-l",
            language,
            "--no-timestamps",
            "-nt",     // no timestamps in output
            "--print-special",
            "false",
        ])
        .output()
        .map_err(|e| format!("whisper.cpp実行に失敗: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper.cpp エラー: {stderr}"));
    }

    let text = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();

    let duration_ms = start.elapsed().as_millis() as u64;

    // Cleanup temp WAV
    let _ = std::fs::remove_file(wav_path);

    Ok(TranscriptionResult {
        text,
        language: language.to_string(),
        duration_ms,
    })
}

/// Simple linear resampling from source rate to target rate.
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = src_idx - idx as f64;

        if idx + 1 < samples.len() {
            let interpolated =
                samples[idx] as f64 * (1.0 - frac) + samples[idx + 1] as f64 * frac;
            output.push(interpolated as f32);
        } else if idx < samples.len() {
            output.push(samples[idx]);
        }
    }

    output
}
