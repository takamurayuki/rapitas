/**
 * providers/cli-utils ユニットテスト
 *
 * resolveCliPath のWindows専用パス解決（`where`実行結果とfs.existsSyncの
 * モック）、buildPrompt のフォールバック連鎖、buildStructuredPrompt の
 * セクション構築を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AgentTaskDefinition } from '../abstraction/types';

let execSyncImpl: (cmd: string) => string = () => '';
let existingPaths = new Set<string>();

mock.module('child_process', () => ({
  execSync: (cmd: string) => execSyncImpl(cmd),
}));

mock.module('fs', () => ({
  existsSync: (p: string) => existingPaths.has(p),
}));

const { resolveCliPath, buildPrompt, buildStructuredPrompt } = await import('./cli-utils');

/** Temporarily overrides process.platform for the duration of `fn`. */
async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T> | T): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { title: 'Title', ...overrides } as AgentTaskDefinition;
}

describe('resolveCliPath', () => {
  beforeEach(() => {
    existingPaths = new Set();
    execSyncImpl = () => '';
  });

  test('returns the input unchanged on non-Windows platforms', async () => {
    await withPlatform('linux', () => {
      expect(resolveCliPath('claude')).toBe('claude');
    });
  });

  test('returns the resolved path on Windows when `where` succeeds and the path exists', async () => {
    await withPlatform('win32', () => {
      execSyncImpl = () => 'C:\\tools\\claude.exe\n';
      existingPaths = new Set(['C:\\tools\\claude.exe']);
      expect(resolveCliPath('claude')).toBe('C:\\tools\\claude.exe');
    });
  });

  test('takes only the first line when `where` returns multiple matches', async () => {
    await withPlatform('win32', () => {
      execSyncImpl = () => 'C:\\tools\\claude.exe\r\nC:\\other\\claude.exe\n';
      existingPaths = new Set(['C:\\tools\\claude.exe', 'C:\\other\\claude.exe']);
      expect(resolveCliPath('claude')).toBe('C:\\tools\\claude.exe');
    });
  });

  test('falls back to the original name when the resolved path does not exist on disk', async () => {
    await withPlatform('win32', () => {
      execSyncImpl = () => 'C:\\ghost\\claude.exe\n';
      existingPaths = new Set(); // resolved path not present
      expect(resolveCliPath('claude')).toBe('claude');
    });
  });

  test('falls back to the original name when `where` throws (command not found)', async () => {
    await withPlatform('win32', () => {
      execSyncImpl = () => {
        throw new Error('not found');
      };
      expect(resolveCliPath('claude')).toBe('claude');
    });
  });
});

describe('buildPrompt', () => {
  test('prefers optimizedPrompt over everything else', () => {
    const task = makeTask({ optimizedPrompt: 'opt', analysis: {} as never, prompt: 'p' });
    expect(buildPrompt(task)).toBe('opt');
  });

  test('builds a structured prompt when analysis is present (no optimizedPrompt)', () => {
    const task = makeTask({ analysis: { summary: 's', complexity: 'low' } as never });
    expect(buildPrompt(task)).toContain('# タスク実装指示');
  });

  test('falls back to prompt when no analysis or optimizedPrompt', () => {
    const task = makeTask({ prompt: 'raw prompt' });
    expect(buildPrompt(task)).toBe('raw prompt');
  });

  test('falls back to description when no prompt or analysis', () => {
    const task = makeTask({ description: 'desc' });
    expect(buildPrompt(task)).toBe('desc');
  });

  test('falls back to title as the last resort', () => {
    const task = makeTask({ title: 'just the title' });
    expect(buildPrompt(task)).toBe('just the title');
  });
});

describe('buildStructuredPrompt', () => {
  test('includes title, summary, and complexity', () => {
    const task = makeTask({
      title: 'My Task',
      analysis: { summary: 'summary text', complexity: 'medium' } as never,
    });
    const result = buildStructuredPrompt(task);
    expect(result).toContain('**タスク名:** My Task');
    expect(result).toContain('**分析サマリー:** summary text');
    expect(result).toContain('**複雑度:** medium');
  });

  test('includes estimatedDuration only when present', () => {
    const withDuration = buildStructuredPrompt(
      makeTask({ analysis: { summary: 's', complexity: 'low', estimatedDuration: 30 } as never }),
    );
    expect(withDuration).toContain('**推定時間:** 30分');

    const withoutDuration = buildStructuredPrompt(
      makeTask({ analysis: { summary: 's', complexity: 'low' } as never }),
    );
    expect(withoutDuration).not.toContain('推定時間');
  });

  test('includes task description under タスク詳細 when present', () => {
    const result = buildStructuredPrompt(
      makeTask({
        description: 'full description',
        analysis: { summary: 's', complexity: 'low' } as never,
      }),
    );
    expect(result).toContain('## タスク詳細');
    expect(result).toContain('full description');
  });

  test('lists subtasks with order, description, and priority', () => {
    const result = buildStructuredPrompt(
      makeTask({
        analysis: {
          summary: 's',
          complexity: 'low',
          subtasks: [{ order: 1, title: 'Step A', description: 'do A', priority: 'high' }],
        } as never,
      }),
    );
    expect(result).toContain('### 1. Step A');
    expect(result).toContain('- **説明:** do A');
    expect(result).toContain('- **優先度:** high');
  });

  test('lists tips under 実装のヒント when present', () => {
    const result = buildStructuredPrompt(
      makeTask({
        analysis: { summary: 's', complexity: 'low', tips: ['tip one', 'tip two'] } as never,
      }),
    );
    expect(result).toContain('## 実装のヒント');
    expect(result).toContain('- tip one');
    expect(result).toContain('- tip two');
  });

  test('omits subtasks and tips sections when both are absent', () => {
    const result = buildStructuredPrompt(
      makeTask({ analysis: { summary: 's', complexity: 'low' } as never }),
    );
    expect(result).not.toContain('実装手順');
    expect(result).not.toContain('実装のヒント');
  });
});
