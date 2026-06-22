/**
 * owner-repo.test
 *
 * Tests for Branded Types utilities:
 * - parseOwnerRepo: regex coverage for https/ssh/edge cases, always lowercases
 * - makeOwnerRepoString: factory for gh CLI --repo args
 * - toOwnerRepoString: struct → string conversion
 * - asOwnerRepoString: unsafe escape hatch (type-safety check via @ts-expect-error)
 */
import { describe, it, expect } from 'bun:test';
import {
  parseOwnerRepo,
  makeOwnerRepoString,
  toOwnerRepoString,
  asOwnerRepoString,
  type OwnerRepo,
  type OwnerRepoString,
} from '../../services/github/owner-repo';

// ─── parseOwnerRepo ───────────────────────────────────────────────────────────

describe('parseOwnerRepo', () => {
  it('https URL → 小文字化した OwnerRepo を返す', () => {
    expect(parseOwnerRepo('https://github.com/Owner/Repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ssh URL (git@github.com:owner/repo.git) → OwnerRepo を返す', () => {
    expect(parseOwnerRepo('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('.git サフィックスなしの https URL', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('末尾スラッシュつきの URL', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo/')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('大文字混じりの URL → 小文字化する', () => {
    expect(parseOwnerRepo('https://github.com/MyOrg/MyRepo.git')).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
    });
  });

  it('? を含む URL → null', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo?tab=readme')).toBeNull();
  });

  it('# を含む URL → null', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo#readme')).toBeNull();
  });

  it('非 github.com URL → null', () => {
    expect(parseOwnerRepo('https://gitlab.com/owner/repo')).toBeNull();
  });

  it('null → null', () => {
    expect(parseOwnerRepo(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseOwnerRepo(undefined)).toBeNull();
  });

  it('空文字 → null', () => {
    expect(parseOwnerRepo('')).toBeNull();
  });

  it('GHE (github.example.com) → null', () => {
    expect(parseOwnerRepo('https://github.example.com/owner/repo')).toBeNull();
  });
});

// ─── makeOwnerRepoString ──────────────────────────────────────────────────────

describe('makeOwnerRepoString', () => {
  it('owner/repo を "owner/repo" 文字列に変換する', () => {
    const s = makeOwnerRepoString('owner', 'repo');
    expect(s).toBe('owner/repo');
  });

  it('大文字入力 → 小文字化する', () => {
    const s = makeOwnerRepoString('MyOrg', 'MyRepo');
    expect(s).toBe('myorg/myrepo');
  });

  it('返り値は string として扱える', () => {
    const s: string = makeOwnerRepoString('a', 'b');
    expect(s).toBe('a/b');
  });
});

// ─── toOwnerRepoString ────────────────────────────────────────────────────────

describe('toOwnerRepoString', () => {
  it('OwnerRepo 構造体 → "owner/repo" 文字列に変換する', () => {
    const or = parseOwnerRepo('https://github.com/myorg/myrepo.git');
    expect(or).not.toBeNull();
    const s = toOwnerRepoString(or!);
    expect(s).toBe('myorg/myrepo');
  });

  it('変換後の文字列は string として扱える', () => {
    const or = parseOwnerRepo('https://github.com/org/proj') as OwnerRepo;
    const s: string = toOwnerRepoString(or);
    expect(s).toBe('org/proj');
  });
});

// ─── asOwnerRepoString ────────────────────────────────────────────────────────

describe('asOwnerRepoString', () => {
  it('既検証文字列をキャストできる', () => {
    const s = asOwnerRepoString('owner/repo');
    expect(s).toBe('owner/repo');
  });
});

// ─── 型安全性確認 ─────────────────────────────────────────────────────────────

describe('型安全性 (compile-time)', () => {
  it('OwnerRepoString は string として利用できる', () => {
    const s: OwnerRepoString = makeOwnerRepoString('org', 'repo');
    const upper = s.toUpperCase();
    expect(upper).toBe('ORG/REPO');
  });

  it('生 string は OwnerRepoString に暗黙代入できない（tsc で型エラー）', () => {
    // @ts-expect-error — 生 string は OwnerRepoString に代入できないことを確認
    const _s: OwnerRepoString = 'org/repo';
    expect(_s).toBe('org/repo'); // runtime では同じ string
  });

  it('OwnerRepo は branded なので生オブジェクトとは非互換（tsc で型エラー）', () => {
    // @ts-expect-error — 生オブジェクトは OwnerRepo に代入できないことを確認
    const _or: OwnerRepo = { owner: 'org', repo: 'repo' };
    expect(_or.owner).toBe('org'); // runtime では同じ値
  });
});
