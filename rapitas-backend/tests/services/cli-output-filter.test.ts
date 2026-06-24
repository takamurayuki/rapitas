import { describe, expect, it, test } from 'bun:test';
import {
  filterCliDiagnosticOutput,
  shouldHideRawCliLine,
} from '../../services/agents/cli-output-filter';

describe('cli-output-filter', () => {
  // ---------------------------------------------------------------------------
  // filterCliDiagnosticOutput（個別 it — 複数フィールド・複数行の異種検証）
  // ---------------------------------------------------------------------------

  it('hides successful command output and file content from live logs', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'succeeded in 3804ms:',
        '/**',
        ' * Some source file content',
        'import { createLogger } from "../../../config/logger";',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('keeps important errors visible', () => {
    const filtered = filterCliDiagnosticOutput(
      'exited 1 in 1694ms:\nCannot find path C:\\tmp\\node_modules because it does not exist.',
      { provider: 'codex' },
    );

    expect(filtered.display).toContain('exited 1');
    expect(filtered.display).toContain('Cannot find path');
    expect(filtered.important).toBe(true);
  });

  it('summarizes command lines without dumping results', () => {
    const filtered = filterCliDiagnosticOutput(
      'exec "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content src/app.ts"',
      { provider: 'codex' },
    );

    expect(filtered.display).toContain('[Command]');
    expect(filtered.display).toContain('Get-Content');
  });

  it('hides diff lines even when they contain command or error-like words', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        '+import { sendAIMessage, type AIProvider } from "../../utils/ai-client";',
        "+ log.warn({ err: aiErr, ideaId }, 'AI conversion failed, using fallback');",
        "log.error({ err, ideaId }, 'Failed to convert idea to task');",
        '+ <option key={cat.id} value={cat.id}>',
        '+ {cat.name}',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides benign Codex telemetry errors', () => {
    const filtered = filterCliDiagnosticOutput(
      '2026-04-29T10:04:29.536900Z ERROR codex_core::session: failed to record rollout',
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides benign Codex arg0 startup warnings', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'WARNING: failed to clean up stale arg0 temp dirs: アクセスが拒否されました。 (os error 5)',
        'WARNING: proceeding, even though we could not update PATH: アクセスが拒否されました。 (os error 5) at path "C:\\Users\\user\\.codex\\tmp\\arg0\\codex-arg0Pn0BPw"',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides standalone file path lists from command output', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'rapitas-backend\\utils\\ai-client\\error-handler.ts',
        '$ rapitas-backend\\pnpm-workspace.yaml',
        'rapitas-frontend\\src\\app\\dashboard\\error.tsx',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides grep-style match lines (path:lineno:content)', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        "rapitas-backend\\routes\\foo.ts:42: log.error({ err }, 'Failed to update task');",
        "rapitas-frontend/src/app/page.tsx:88: return { error: 'not found' };",
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // shouldHideRawCliLine（test.each テーブル — 単純な line → boolean 検証）
  // ---------------------------------------------------------------------------

  describe('shouldHideRawCliLine', () => {
    type HideCase = { label: string; line: string; expected: boolean };

    /**
     * shouldHideRawCliLine の全入出力ケース。
     * 元々 4 つの it ブロック（raw-code / file-path / codex-label / grep）に散在していた
     * 単行アサーションを 1 テーブルに集約。
     */
    const hideLineCases: HideCase[] = [
      // コードライクな行
      { label: 'import 文',                          line: 'import { foo } from "./bar";',                                                                     expected: true  },
      { label: 'const 代入',                         line: 'const value = createThing();',                                                                    expected: true  },
      { label: 'log.error 呼び出し',                 line: "log.error({ err }, 'Failed to convert idea to task');",                                            expected: true  },
      { label: 'return 文（日本語文字列）',           line: "return { error: 'アイデアが見つかりません' };",                                                    expected: true  },
      { label: '人間可読なステータス行',             line: 'short human-readable status',                                                                     expected: false },
      // ファイルパス行
      { label: 'Windowsパス .ts ファイル',           line: 'rapitas-backend\\services\\system\\error-capture.ts',                                              expected: true  },
      { label: '$ プレフィックス + bun.lock パス',   line: '$ rapitas-backend\\bun.lock',                                                                      expected: true  },
      // codex ツールラベル + コードブロック
      { label: '調査: JSX の map 開始',              line: '調査: {categories.map((cat) => (',                                                                 expected: true  },
      { label: '調査: JSX 式',                       line: '調査: {cat.name}',                                                                                 expected: true  },
      { label: 'Investigation: オブジェクトリテラル', line: 'Investigation: { foo: 1 }',                                                                        expected: true  },
      { label: '$ catch ブロック',                   line: '$ } catch (error) {',                                                                              expected: true  },
      { label: 'catch ブロック',                     line: '} catch (error) {',                                                                                expected: true  },
      { label: 'ブロックコメント',                   line: '/* error */',                                                                                       expected: true  },
      { label: '閉じ波括弧のみ',                    line: '}',                                                                                                  expected: true  },
      { label: 'else ブロック',                      line: '} else {',                                                                                          expected: true  },
      // 調査: ラベルでも重要キーワードを含む行は残す
      { label: '調査: timeout（重要キーワード含む）', line: '調査: timeout exceeded after 30s',                                                                 expected: false },
      // grep スタイルの path:lineno:content 行
      { label: '$ grep 行: bun.lock semver',         line: '$ rapitas-backend\\bun.lock:8: "@anthropic-ai/sdk": "^0.52.0",',                                   expected: true  },
      { label: 'grep 行: bun.lock パッケージ',       line: 'rapitas-backend\\bun.lock:623: "pino": ["pino@10.3.1"',                                            expected: true  },
      { label: '調査: grep 行 levn',                 line: '調査: rapitas-backend\\bun.lock:537: "levn": ["levn@0.4.1", "", { "depende...',                    expected: true  },
      { label: 'フロントエンドファイル:行番号:コード', line: 'rapitas-frontend/src/app/page.tsx:42: const x = 1;',                                              expected: true  },
      // コロン+数値でも grep 形式でない行は残す
      { label: '非grep: コロン+数値は行番号なし',    line: 'Result code is 42: success',                                                                       expected: false },
    ];

    test.each(hideLineCases)('$label → $expected', ({ line, expected }) => {
      expect(shouldHideRawCliLine(line)).toBe(expected);
    });
  });
});
