/**
 * ローカルLLMモデル & llama-serverバイナリのダウンロード管理
 * - Qwen2.5-0.5B Q4_K_M GGUF形式モデル
 * - llama-server バイナリ (llama.cpp GitHub releases)
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../config';

const log = createLogger('local-llm:model-downloader');

// Qwen2.5-0.5B-Instruct Q4_K_M (~400MB)
const DEFAULT_MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const DEFAULT_MODEL_FILENAME = 'qwen2.5-0.5b-instruct-q4_k_m.gguf';
const EXPECTED_SIZE_MB = 400;

// llama-server バイナリ
const LLAMA_CPP_VERSION = 'b5280';
const LLAMA_SERVER_BINARY = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

function getLlamaCppDownloadUrl(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    if (arch === 'x64')
      return `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-win-cpu-x64.zip`;
    if (arch === 'arm64')
      return `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-win-arm64.zip`;
  } else if (platform === 'darwin') {
    return `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-macos-arm64.zip`;
  } else if (platform === 'linux') {
    return `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.zip`;
  }

  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

export type DownloadProgress = {
  status: 'idle' | 'downloading' | 'completed' | 'error';
  progress: number; // 0-100
  downloadedMB: number;
  totalMB: number;
  error?: string;
};

let currentProgress: DownloadProgress = {
  status: 'idle',
  progress: 0,
  downloadedMB: 0,
  totalMB: EXPECTED_SIZE_MB,
};

/**
 * rapitas専用ディレクトリのルートを取得
 */
function getRapitasDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.rapitas');
}

/**
 * モデルの保存先ディレクトリを取得
 */
export function getModelsDir(): string {
  const modelsDir = join(getRapitasDir(), 'models');
  if (!existsSync(modelsDir)) {
    mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

/**
 * バイナリの保存先ディレクトリを取得
 */
export function getBinDir(): string {
  const binDir = join(getRapitasDir(), 'bin');
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
  return binDir;
}

/**
 * モデルファイルのパスを取得
 */
export function getModelPath(filename?: string): string {
  return join(getModelsDir(), filename || DEFAULT_MODEL_FILENAME);
}

/**
 * llama-serverバイナリのパスを取得
 */
export function getLlamaServerPath(): string {
  return join(getBinDir(), LLAMA_SERVER_BINARY);
}

/**
 * モデルがダウンロード済みかチェック
 */
export function isModelDownloaded(filename?: string): boolean {
  const modelPath = getModelPath(filename);
  if (!existsSync(modelPath)) return false;

  // ファイルサイズが極端に小さい場合は不完全なダウンロード
  const stats = statSync(modelPath);
  return stats.size > 100 * 1024 * 1024; // 100MB以上あればOK
}

/**
 * llama-serverバイナリがダウンロード済みかチェック
 */
export function isLlamaServerDownloaded(): boolean {
  const binaryPath = getLlamaServerPath();
  if (!existsSync(binaryPath)) return false;
  const stats = statSync(binaryPath);
  return stats.size > 100 * 1024; // 100KB以上あればOK
}

/**
 * 現在のダウンロード進捗を取得
 */
export function getDownloadProgress(): DownloadProgress {
  return { ...currentProgress };
}

/**
 * 汎用ファイルダウンロード（進捗追跡付き）
 */
async function downloadFile(url: string, destPath: string, expectedSizeMB: number): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(600000), // 10分タイムアウト
  });

  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} from ${url}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const totalMB = contentLength > 0 ? contentLength / (1024 * 1024) : expectedSizeMB;
  currentProgress.totalMB = Math.round(totalMB);

  if (!response.body) {
    throw new Error('No response body');
  }

  const tmpPath = destPath + '.tmp';
  const writer = createWriteStream(tmpPath);
  const reader = response.body.getReader();

  let downloadedBytes = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    writer.write(Buffer.from(value));
    downloadedBytes += value.length;

    const downloadedMB = downloadedBytes / (1024 * 1024);
    const progress =
      contentLength > 0
        ? Math.round((downloadedBytes / contentLength) * 100)
        : Math.min(99, Math.round((downloadedMB / expectedSizeMB) * 100));

    currentProgress = {
      status: 'downloading',
      progress,
      downloadedMB: Math.round(downloadedMB * 10) / 10,
      totalMB: Math.round(totalMB),
    };
  }

  writer.end();

  await new Promise<void>((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const { renameSync } = await import('fs');
  renameSync(tmpPath, destPath);
}

/**
 * ZIPからllama-serverを抽出
 */
async function extractLlamaServerFromZip(zipPath: string): Promise<string> {
  const { execSync } = await import('child_process');
  const binDir = getBinDir();
  const targetName = LLAMA_SERVER_BINARY;
  const targetPath = join(binDir, targetName);

  if (process.platform === 'win32') {
    // PowerShellで展開してllama-server.exe + 依存DLLをコピー
    const extractDir = join(binDir, '_llama_tmp');
    mkdirSync(extractDir, { recursive: true });

    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
        { timeout: 60000 },
      );

      // llama-server.exe を再帰的に探す
      const found = execSync(
        `powershell -Command "Get-ChildItem -Path '${extractDir}' -Recurse -Filter '${targetName}' | Select-Object -First 1 -ExpandProperty FullName"`,
        { timeout: 10000, encoding: 'utf-8' },
      ).trim();

      if (!found || !existsSync(found)) {
        throw new Error(`${targetName} not found in archive`);
      }

      const { copyFileSync, readdirSync } = await import('fs');
      const { dirname } = await import('path');

      // llama-server.exe をコピー
      copyFileSync(found, targetPath);

      // 同じディレクトリにある .dll ファイルもすべてコピー（ggml.dll等の依存ライブラリ）
      const serverDir = dirname(found);
      const files = readdirSync(serverDir);
      for (const file of files) {
        if (file.endsWith('.dll')) {
          const srcDll = join(serverDir, file);
          const destDll = join(binDir, file);
          copyFileSync(srcDll, destDll);
          log.info(`Copied dependency: ${file}`);
        }
      }

      // 一時ディレクトリとZIPを削除
      execSync(`powershell -Command "Remove-Item -Path '${extractDir}' -Recurse -Force"`, {
        timeout: 10000,
      });
    } catch (error) {
      // クリーンアップ
      try {
        if (existsSync(extractDir)) {
          execSync(`powershell -Command "Remove-Item -Path '${extractDir}' -Recurse -Force"`, {
            timeout: 10000,
          });
        }
      } catch {
        /* ignore */
      }
      throw error;
    }
  } else {
    // Unix: unzipで展開
    const extractDir = join(binDir, '_llama_tmp');
    mkdirSync(extractDir, { recursive: true });

    try {
      execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { timeout: 60000 });

      // llama-server を探す
      const found = execSync(`find "${extractDir}" -name "llama-server" -type f | head -1`, {
        timeout: 10000,
        encoding: 'utf-8',
      }).trim();

      if (!found || !existsSync(found)) {
        throw new Error('llama-server not found in archive');
      }

      const { copyFileSync, readdirSync } = await import('fs');
      const { dirname } = await import('path');

      copyFileSync(found, targetPath);
      chmodSync(targetPath, 0o755);

      // 同じディレクトリの .so / .dylib もコピー
      const serverDir = dirname(found);
      const files = readdirSync(serverDir);
      for (const file of files) {
        if (file.endsWith('.so') || file.includes('.so.') || file.endsWith('.dylib')) {
          const src = join(serverDir, file);
          const dest = join(binDir, file);
          copyFileSync(src, dest);
          chmodSync(dest, 0o755);
        }
      }

      execSync(`rm -rf "${extractDir}"`, { timeout: 10000 });
    } catch (error) {
      try {
        if (existsSync(extractDir)) execSync(`rm -rf "${extractDir}"`, { timeout: 10000 });
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  // ZIPを削除
  try {
    unlinkSync(zipPath);
  } catch {
    /* ignore */
  }

  return targetPath;
}

/**
 * llama-serverバイナリをダウンロード
 */
export async function downloadLlamaServer(): Promise<{
  success: boolean;
  path: string;
  error?: string;
}> {
  const binaryPath = getLlamaServerPath();

  if (isLlamaServerDownloaded()) {
    log.info(`llama-server already exists: ${binaryPath}`);
    return { success: true, path: binaryPath };
  }

  log.info('Downloading llama-server binary...');

  try {
    const downloadUrl = getLlamaCppDownloadUrl();
    const zipPath = join(getBinDir(), 'llama-cpp.zip');

    log.info(`Downloading from: ${downloadUrl}`);
    await downloadFile(downloadUrl, zipPath, 50);

    log.info('Extracting llama-server from archive...');
    const extractedPath = await extractLlamaServerFromZip(zipPath);

    log.info(`llama-server ready at: ${extractedPath}`);
    return { success: true, path: extractedPath };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error({ err: error }, 'Failed to download llama-server');
    return { success: false, path: binaryPath, error: errMsg };
  }
}

/**
 * モデルをダウンロード（llama-serverも自動でダウンロード）
 */
export async function downloadModel(
  url?: string,
  filename?: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  const modelUrl = url || DEFAULT_MODEL_URL;
  const modelFilename = filename || DEFAULT_MODEL_FILENAME;
  const modelPath = getModelPath(modelFilename);

  if (isModelDownloaded(modelFilename)) {
    log.info(`Model already exists: ${modelPath}`);
    currentProgress = {
      status: 'completed',
      progress: 100,
      downloadedMB: EXPECTED_SIZE_MB,
      totalMB: EXPECTED_SIZE_MB,
    };
    // モデルがあってもllama-serverがなければダウンロード
    if (!isLlamaServerDownloaded()) {
      await downloadLlamaServer();
    }
    return { success: true, path: modelPath };
  }

  log.info(`Downloading model from ${modelUrl} to ${modelPath}`);

  currentProgress = {
    status: 'downloading',
    progress: 0,
    downloadedMB: 0,
    totalMB: EXPECTED_SIZE_MB,
  };

  try {
    await downloadFile(modelUrl, modelPath, EXPECTED_SIZE_MB);

    currentProgress = {
      status: 'completed',
      progress: 100,
      downloadedMB: EXPECTED_SIZE_MB,
      totalMB: EXPECTED_SIZE_MB,
    };

    log.info(`Model downloaded successfully: ${modelPath}`);

    // llama-serverバイナリもダウンロード
    if (!isLlamaServerDownloaded()) {
      log.info('Also downloading llama-server binary...');
      const serverResult = await downloadLlamaServer();
      if (!serverResult.success) {
        log.warn(`llama-server download failed: ${serverResult.error}`);
      }
    }

    return { success: true, path: modelPath };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error({ err: error }, `Model download failed`);

    currentProgress = {
      status: 'error',
      progress: 0,
      downloadedMB: 0,
      totalMB: EXPECTED_SIZE_MB,
      error: errMsg,
    };

    // 不完全な一時ファイルを削除
    const tmpPath = modelPath + '.tmp';
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }

    return { success: false, path: modelPath, error: errMsg };
  }
}

/**
 * モデルを削除
 */
export function deleteModel(filename?: string): boolean {
  const modelPath = getModelPath(filename);
  try {
    if (existsSync(modelPath)) {
      unlinkSync(modelPath);
      log.info(`Model deleted: ${modelPath}`);
      currentProgress = {
        status: 'idle',
        progress: 0,
        downloadedMB: 0,
        totalMB: EXPECTED_SIZE_MB,
      };
      return true;
    }
    return false;
  } catch (error) {
    log.error({ err: error }, `Failed to delete model`);
    return false;
  }
}
