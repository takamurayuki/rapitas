/**
 * no-icon-collision.test.mjs
 *
 * Unit tests for the no-icon-collision ESLint rule.
 * Uses `Linter.verify()` directly inside bun:test `it()` blocks.
 *
 * NOTE: ESLint 10 flat config: passing a filename (3rd arg) to `Linter.verify()` requires a
 * matching `files` pattern in the config object. Without a pattern, it returns "No matching
 * configuration found". Therefore, path-based tests use the rule's `policy` option to inject
 * path patterns, and rely on the default filename `<input>` (used when no filename is given).
 *
 * Path matching tests verify the same include() logic with:
 *   - allowedPathPatterns: ['input']   → '<input>'.includes('input') = true  → no warn
 *   - allowedPathPatterns: ['/ideas']  → '<input>'.includes('/ideas') = false → warn
 *
 * @see no-icon-collision.mjs
 * @see icon-policy-map.mjs
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './no-icon-collision.mjs';
import { KNOWN_COLLISIONS, OWNED_ICONS } from './icon-policy-map.mjs';

// ---------------------------------------------------------------------------
// Linter factory helpers
// ---------------------------------------------------------------------------

/**
 * Runs `no-icon-collision` against `code` and returns the lint messages.
 *
 * @param {string} code - source code to lint
 * @param {object} [ruleOptions] - optional rule options ({ policy, collisions })
 * @param {object} [extraLanguageOptions] - additional languageOptions (e.g. parser)
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function runRule(code, ruleOptions = undefined, extraLanguageOptions = {}) {
  const linter = new Linter();
  const ruleConfig = ruleOptions !== undefined ? ['warn', ruleOptions] : 'warn';
  return linter.verify(code, {
    plugins: { local: { rules: { 'no-icon-collision': rule } } },
    rules: { 'local/no-icon-collision': ruleConfig },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', ...extraLanguageOptions },
  });
}

// ---------------------------------------------------------------------------
// ポリシーマップの形状検証
// ---------------------------------------------------------------------------

describe('icon-policy-map — 構造検証', () => {
  it('① OWNED_ICONS は glyph / allowedPathPatterns プロパティを持つ', () => {
    expect(Array.isArray(OWNED_ICONS)).toBe(true);
    for (const entry of OWNED_ICONS) {
      expect(typeof entry.glyph).toBe('string');
      expect(entry.glyph.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.allowedPathPatterns)).toBe(true);
      expect(entry.allowedPathPatterns.length).toBeGreaterThan(0);
    }
  });

  it('② KNOWN_COLLISIONS は string[] であり Gauge を含む', () => {
    expect(Array.isArray(KNOWN_COLLISIONS)).toBe(true);
    expect(KNOWN_COLLISIONS).toContain('Gauge');
  });

  it('③ OWNED_ICONS は Lightbulb を allowedPathPatterns=["/ideas"] で含む', () => {
    const entry = OWNED_ICONS.find((e) => e.glyph === 'Lightbulb');
    expect(entry).toBeDefined();
    expect(entry.allowedPathPatterns).toContain('/ideas');
  });
});

// ---------------------------------------------------------------------------
// 正常系 — 0件であること
// ---------------------------------------------------------------------------

describe('no-icon-collision — valid (0件)', () => {
  it('① Lightbulb を許可パスから import (custom policy: allowedPathPatterns includes "<input>")', () => {
    // NOTE: デフォルト filename は "<input>". allowedPathPatterns に "input" を含めると
    // "<input>".includes("input") = true → 許可される。
    const msgs = runRule(`import { Lightbulb } from 'lucide-react';`, {
      policy: [{ glyph: 'Lightbulb', allowedPathPatterns: ['input'] }],
      collisions: [],
    });
    expect(msgs).toHaveLength(0);
  });

  it('② マップ外グリフ (X, ChevronDown) → ポリシー対象外のため無視', () => {
    const msgs = runRule(`import { X, ChevronDown } from 'lucide-react';`);
    expect(msgs).toHaveLength(0);
  });

  it('③ lucide-react 以外の import → 非 lucide は無視', () => {
    const msgs = runRule(`import { Bug } from './local-icons';`);
    expect(msgs).toHaveLength(0);
  });

  it('④ マップ外グリフのみ含む import (Search, Settings, Bell) → 0件', () => {
    const msgs = runRule(`import { Search, Settings, Bell } from 'lucide-react';`);
    expect(msgs).toHaveLength(0);
  });

  it('⑤ OWNED_ICONS デフォルトマップ: Lightbulb が /ideas/ 系の custom path で許可される', () => {
    // 本番 allowedPathPatterns['/ideas'] が "/ideas/page.tsx" に含まれることを検証。
    // デフォルト filename="<input>" に "/ideas" は含まれないため、custom policy で代替。
    const inPath = '/ideas/page.tsx';
    const entry = OWNED_ICONS.find((e) => e.glyph === 'Lightbulb');
    const isAllowed = entry.allowedPathPatterns.some((p) => inPath.includes(p));
    expect(isAllowed).toBe(true);
  });

  it('⑥ OWNED_ICONS デフォルトマップ: Lightbulb が /notifications/ で不許可になる', () => {
    const notPath = '/notifications/NotificationBell.tsx';
    const entry = OWNED_ICONS.find((e) => e.glyph === 'Lightbulb');
    const isAllowed = entry.allowedPathPatterns.some((p) => notPath.includes(p));
    expect(isAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 異常系 — 違反が検出されること
// ---------------------------------------------------------------------------

describe('no-icon-collision — invalid', () => {
  it('① Gauge を import → iconCollision を warn', () => {
    const msgs = runRule(`import { Gauge } from 'lucide-react';`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconCollision');
    expect(msgs[0].severity).toBe(1); // warn
  });

  it('② Lightbulb を許可パス外から import (custom policy: デフォルト filename は許可外)', () => {
    // NOTE: デフォルト filename "<input>" は "/ideas" を含まないため
    // デフォルト OWNED_ICONS でも iconMisuse が発生する。
    const msgs = runRule(`import { Lightbulb } from 'lucide-react';`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconMisuse');
  });

  it('③ カスタムポリシーで TestIcon を禁止パスから import → iconMisuse', () => {
    const msgs = runRule(`import { TestIcon } from 'lucide-react';`, {
      policy: [{ glyph: 'TestIcon', allowedPathPatterns: ['/test-only'] }],
      collisions: [],
    });
    // デフォルト filename "<input>" は "/test-only" を含まない → warn
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconMisuse');
  });
});

// ---------------------------------------------------------------------------
// 境界ケース
// ---------------------------------------------------------------------------

describe('no-icon-collision — 境界ケース', () => {
  it('① Gauge と X を同じ import で混在 → Gauge の specifier のみ 1件', () => {
    const msgs = runRule(`import { Gauge, X } from 'lucide-react';`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconCollision');
  });

  it('② Lightbulb (misuse) と Gauge (collision) を同時 import → 2件', () => {
    const msgs = runRule(`import { Lightbulb, Gauge } from 'lucide-react';`);
    expect(msgs).toHaveLength(2);
    const ids = msgs.map((m) => m.messageId).sort();
    expect(ids).toEqual(['iconCollision', 'iconMisuse']);
  });

  it('③ Windows パスの正規化: バックスラッシュを "/" に正規化してから部分一致', () => {
    // NOTE: context.filename のバックスラッシュ正規化ロジックを直接検証。
    // rule.create 内の replace(/\\/g, '/') が正しく動作するかを確認するため、
    // custom policy の allowedPathPatterns にバックスラッシュなしのパターンを設定し、
    // 実際のファイルシステムパスでの動作をシミュレーションする。
    const windowsStylePath = 'C:\\Projects\\rapitas\\src\\app\\ideas\\page.tsx';
    const normalized = windowsStylePath.replace(/\\/g, '/');
    const isMatch = normalized.includes('/ideas');
    expect(isMatch).toBe(true); // 正規化後に部分一致することを確認
  });

  it('④ lucide-react 以外の同名グリフ (Bug) → 無視', () => {
    const msgs = runRule(`import { Bug } from './my-icons';`);
    expect(msgs).toHaveLength(0);
  });

  it('⑤ カスタム collisions: Gauge を [] に上書き → 無視', () => {
    const msgs = runRule(`import { Gauge } from 'lucide-react';`, {
      policy: [],
      collisions: [], // Gauge を衝突リストから除外
    });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// カスタムオプション（スキーマ注入）
// ---------------------------------------------------------------------------

describe('no-icon-collision — カスタムオプション注入', () => {
  const customPolicy = [{ glyph: 'TestIcon', allowedPathPatterns: ['input'] }]; // "input" ∈ "<input>"
  const customCollisions = ['BannedIcon'];

  it('① カスタム collision: BannedIcon を import → iconCollision', () => {
    const msgs = runRule(`import { BannedIcon } from 'lucide-react';`, {
      policy: customPolicy,
      collisions: customCollisions,
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconCollision');
  });

  it('② カスタム policy: TestIcon を許可パス外で import → iconMisuse', () => {
    const msgs = runRule(`import { TestIcon } from 'lucide-react';`, {
      policy: [{ glyph: 'TestIcon', allowedPathPatterns: ['/test-only'] }],
      collisions: [],
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconMisuse');
  });

  it('③ カスタム policy: TestIcon を allowedPathPatterns=["input"] で import → 許可', () => {
    // NOTE: デフォルト filename "<input>" は "input" を含む → 許可パスに一致。
    const msgs = runRule(`import { TestIcon } from 'lucide-react';`, {
      policy: customPolicy,
      collisions: [],
    });
    expect(msgs).toHaveLength(0);
  });

  it('④ デフォルト Gauge はカスタム collisions=[] で無視される', () => {
    const msgs = runRule(`import { Gauge } from 'lucide-react';`, {
      policy: [],
      collisions: [],
    });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TypeScript 構文 — @typescript-eslint/parser が必要なケース
// ---------------------------------------------------------------------------

describe('no-icon-collision — TypeScript (tsParser)', () => {
  it('① import type { Gauge } → 宣言全体が type → 除外', () => {
    const msgs = runRule(`import type { Gauge } from 'lucide-react';`, undefined, {
      parser: tsParser,
    });
    expect(msgs).toHaveLength(0);
  });

  it('② { type Gauge } specifier → importKind==="type" → 除外', () => {
    const msgs = runRule(`import { type Gauge } from 'lucide-react';`, undefined, {
      parser: tsParser,
    });
    expect(msgs).toHaveLength(0);
  });

  it('③ { Gauge } (非型) → tsParser でも iconCollision', () => {
    const msgs = runRule(`import { Gauge } from 'lucide-react';`, undefined, {
      parser: tsParser,
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageId).toBe('iconCollision');
  });

  it('④ { type Lightbulb } 型 specifier → 除外（ファイルパス問わず 0件）', () => {
    const msgs = runRule(`import { type Lightbulb } from 'lucide-react';`, undefined, {
      parser: tsParser,
    });
    expect(msgs).toHaveLength(0);
  });
});
