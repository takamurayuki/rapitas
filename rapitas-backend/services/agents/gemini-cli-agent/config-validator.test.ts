/**
 * gemini-cli-agent/config-validator ユニットテスト
 *
 * CLI可用性チェック(checkGeminiAvailability)をモックし、APIキーの有無・
 * 作業ディレクトリの存在/種別チェックによる errors 配列の組み立てを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let cliAvailable = true;
const mockCheckGeminiAvailability = mock(() => Promise.resolve(cliAvailable));

mock.module('./process-manager', () => ({
  checkGeminiAvailability: mockCheckGeminiAvailability,
}));

const { validateAgentConfig } = await import('./config-validator');

describe('validateAgentConfig', () => {
  let dir: string;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    cliAvailable = true;
    dir = mkdtempSync(path.join(tmpdir(), 'rapitas-gemini-config-validator-'));
    delete process.env.GEMINI_API_KEY;
  });

  function cleanup() {
    rmSync(dir, { recursive: true, force: true });
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  }

  test('is valid with no errors when the CLI is available and no workingDirectory given', async () => {
    const result = await validateAgentConfig({} as never, '[test]');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    cleanup();
  });

  test('reports an error when the Gemini CLI is not available', async () => {
    cliAvailable = false;
    const result = await validateAgentConfig({} as never, '[test]');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Gemini CLI is not installed');
    cleanup();
  });

  test('accepts an existing working directory without error', async () => {
    const result = await validateAgentConfig({ workingDirectory: dir } as never, '[test]');
    expect(result.valid).toBe(true);
    cleanup();
  });

  test('reports an error when the working directory does not exist', async () => {
    const missing = path.join(dir, 'does-not-exist');
    const result = await validateAgentConfig({ workingDirectory: missing } as never, '[test]');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not exist'))).toBe(true);
    cleanup();
  });

  test('reports an error when the working directory is a file, not a directory', async () => {
    const filePath = path.join(dir, 'a-file.txt');
    writeFileSync(filePath, 'not a directory');
    const result = await validateAgentConfig({ workingDirectory: filePath } as never, '[test]');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('is not a directory'))).toBe(true);
    cleanup();
  });

  test('combines multiple validation failures into the errors array', async () => {
    cliAvailable = false;
    const missing = path.join(dir, 'does-not-exist');
    const result = await validateAgentConfig({ workingDirectory: missing } as never, '[test]');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    cleanup();
  });

  test('does not error when apiKey is explicitly provided', async () => {
    const result = await validateAgentConfig({ apiKey: 'test-key' } as never, '[test]');
    expect(result.valid).toBe(true);
    cleanup();
  });

  test('does not error when GEMINI_API_KEY env var is set instead', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const result = await validateAgentConfig({} as never, '[test]');
    expect(result.valid).toBe(true);
    cleanup();
  });
});
