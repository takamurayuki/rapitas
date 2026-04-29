/**
 * Tool Name Canonicalizer テスト
 *
 * Verifies that provider-specific tool names map onto Claude's canonical
 * vocabulary so the frontend log-pattern table renders uniformly.
 */
import { describe, it, expect } from 'bun:test';
import { canonicalToolName } from '../../services/agents/common/tool-name-canonicalizer';

describe('canonicalToolName', () => {
  it('Gemini ReadFile/WriteFile/FindFiles/SearchText/Shell を Claude名に揃える', () => {
    expect(canonicalToolName('ReadFile')).toBe('Read');
    expect(canonicalToolName('WriteFile')).toBe('Write');
    expect(canonicalToolName('FindFiles')).toBe('Glob');
    expect(canonicalToolName('SearchText')).toBe('Grep');
    expect(canonicalToolName('Shell')).toBe('Bash');
  });

  it('Codex の小文字 / snake_case 系も揃える', () => {
    expect(canonicalToolName('read_file')).toBe('Read');
    expect(canonicalToolName('write_file')).toBe('Write');
    expect(canonicalToolName('apply_patch')).toBe('Edit');
    expect(canonicalToolName('local_shell')).toBe('Bash');
    expect(canonicalToolName('run_command')).toBe('Bash');
  });

  it('Web 系も統一する', () => {
    expect(canonicalToolName('GoogleSearch')).toBe('WebSearch');
    expect(canonicalToolName('google_search')).toBe('WebSearch');
    expect(canonicalToolName('fetch_url')).toBe('WebFetch');
  });

  it('Claude のツール名はそのまま通す', () => {
    expect(canonicalToolName('Read')).toBe('Read');
    expect(canonicalToolName('Bash')).toBe('Bash');
    expect(canonicalToolName('Edit')).toBe('Edit');
  });

  it('未知の名前はそのまま通す（フロントの汎用パターンに任せる）', () => {
    expect(canonicalToolName('SomeNewTool')).toBe('SomeNewTool');
  });

  it('空・null・undefined は "unknown"', () => {
    expect(canonicalToolName('')).toBe('unknown');
    expect(canonicalToolName(null)).toBe('unknown');
    expect(canonicalToolName(undefined)).toBe('unknown');
  });
});
