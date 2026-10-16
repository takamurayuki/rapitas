import { describe, test, expect } from 'bun:test';
import {
  getModelsDir,
  getBinDir,
  getModelPath,
  getLlamaServerPath,
  isModelDownloaded,
  isLlamaServerDownloaded,
  getDownloadProgress,
} from './model-downloader';

// NOTE: This module has no injectable path for ~/.rapitas — it always reads
// the REAL directory, which on this machine already holds a real, genuinely
// downloaded model + llama-server binary. Only read-only / idempotent-mkdir
// functions are exercised here; downloadModel/downloadLlamaServer/deleteModel
// are deliberately NOT tested (they would touch real network/filesystem
// state, including potentially deleting the user's actual downloaded model).

describe('getModelsDir / getBinDir', () => {
  test('returns a path under a .rapitas directory', () => {
    expect(getModelsDir()).toContain('.rapitas');
    expect(getModelsDir().endsWith('models') || getModelsDir().includes(`models`)).toBe(true);
  });

  test('returns a path under a .rapitas/bin directory', () => {
    expect(getBinDir()).toContain('.rapitas');
    expect(getBinDir().includes('bin')).toBe(true);
  });

  test('is idempotent (same path on repeated calls)', () => {
    expect(getModelsDir()).toBe(getModelsDir());
    expect(getBinDir()).toBe(getBinDir());
  });
});

describe('getModelPath / getLlamaServerPath', () => {
  test('getModelPath defaults to the qwen GGUF filename', () => {
    expect(getModelPath()).toContain('qwen2.5-0.5b-instruct-q4_k_m.gguf');
  });

  test('getModelPath accepts a custom filename', () => {
    expect(getModelPath('custom-model.gguf')).toContain('custom-model.gguf');
  });

  test('getLlamaServerPath returns a platform-appropriate binary name', () => {
    const p = getLlamaServerPath();
    if (process.platform === 'win32') {
      expect(p.endsWith('llama-server.exe')).toBe(true);
    } else {
      expect(p.endsWith('llama-server')).toBe(true);
    }
  });
});

describe('isModelDownloaded / isLlamaServerDownloaded', () => {
  test('returns a boolean without throwing', () => {
    expect(typeof isModelDownloaded()).toBe('boolean');
    expect(typeof isLlamaServerDownloaded()).toBe('boolean');
  });

  test('returns false for a filename that certainly does not exist', () => {
    expect(isModelDownloaded('definitely-not-a-real-model-file-xyz123.gguf')).toBe(false);
  });
});

describe('getDownloadProgress', () => {
  test('returns a well-shaped progress object', () => {
    const progress = getDownloadProgress();
    expect(['idle', 'downloading', 'completed', 'error']).toContain(progress.status);
    expect(typeof progress.progress).toBe('number');
    expect(typeof progress.downloadedMB).toBe('number');
    expect(typeof progress.totalMB).toBe('number');
  });

  test('returns a fresh copy each time (not the same object reference)', () => {
    expect(getDownloadProgress()).not.toBe(getDownloadProgress());
  });
});
