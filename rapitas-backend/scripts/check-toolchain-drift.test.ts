/**
 * check-toolchain-drift ユニットテスト
 *
 * ツールチェーン固定の判定を検証する。
 *
 * このチェック自体が「走っているが何も測っていないゲート」になりうるので、
 * 捕まえるべきものを捕まえ、捕まえてはいけないものを見逃すことの両方を固定する。
 */
import { describe, test, expect } from 'bun:test';
import { findToolchainViolations, findUnfrozenInstalls } from './check-toolchain-drift';

const TC = { bun: '1.3.13', pnpm: '10.34.9', node: '24' };

/** Run the checker over a YAML fragment. */
function check(yaml: string) {
  return findToolchainViolations(yaml, 'w.yml', TC);
}

/** Run the lockfile checker over a YAML fragment. */
function checkFrozen(yaml: string, file = 'w.yml') {
  return findUnfrozenInstalls(yaml, file);
}

describe('捕まえるべきもの', () => {
  test('bun-version: latest', () => {
    const v = check(
      '      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: latest\n',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.tool).toBe('bun');
    expect(v[0]!.found).toBe('latest');
  });

  test('クォート付きの古い固定版', () => {
    expect(check("          bun-version: '1.3.11'\n")).toHaveLength(1);
  });

  // tauri-build.yml はここを通さず matrix 経由で bun を渡していたため、
  // リリースビルドだけ 1.3.11 で走っていた（#1340 step 1 で発見）。
  test('matrix が宣言する bunjs_version', () => {
    const v = check("          - bunjs_version: '1.3.11'\n");
    expect(v).toHaveLength(1);
    expect(v[0]!.tool).toBe('bun');
  });

  test('メジャーだけの pnpm 指定', () => {
    const v = check('        run: npm install -g pnpm@10\n');
    expect(v).toHaveLength(1);
    expect(v[0]!.tool).toBe('pnpm');
    expect(v[0]!.found).toBe('10');
  });

  // #1340 step 1 の見落とし: この形式を読んでいなかったため、performance.yml が
  // pnpm 9 で固定されたまま「全ワークフロー一致」と報告していた。
  // 形式を知らない検査は、知らない形式について嘘をつく。
  test('pnpm/action-setup の with: version 形式', () => {
    const v = check(
      '      - name: Setup pnpm\n        uses: pnpm/action-setup@v4\n        with:\n          version: 9\n',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.tool).toBe('pnpm');
    expect(v[0]!.found).toBe('9');
  });

  test('action-setup 形式でパッチ違いも捕まえること', () => {
    const v = check(
      '        uses: pnpm/action-setup@v4\n        with:\n          version: 10.30.0\n',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.found).toBe('10.30.0');
  });

  test('action-setup と run 形式が混在していれば両方報告すること', () => {
    const v = check(
      '        uses: pnpm/action-setup@v4\n        with:\n          version: 9\n' +
        '        run: npm install -g pnpm@10\n',
    );
    expect(v).toHaveLength(2);
  });

  test('node のメジャー違い', () => {
    const v = check("          node-version: '22'\n");
    expect(v).toHaveLength(1);
    expect(v[0]!.tool).toBe('node');
  });

  test('1ファイル内の複数違反を全部報告すること', () => {
    const v = check(
      "          bun-version: latest\n        run: npm install -g pnpm@10\n          node-version: '22'\n",
    );
    expect(v).toHaveLength(3);
  });

  test('行番号を報告すること', () => {
    const v = check('# a\n# b\n          bun-version: latest\n');
    expect(v[0]!.line).toBe(3);
  });
});

describe('見逃すべきもの', () => {
  test('固定版が一致していれば違反なし', () => {
    expect(
      check(
        "          bun-version: '1.3.13'\n        run: npm install -g pnpm@10.34.9\n          node-version: '24'\n",
      ),
    ).toHaveLength(0);
  });

  test('クォート無しでも一致を認めること', () => {
    expect(check('          bun-version: 1.3.13\n')).toHaveLength(0);
  });

  // マトリクスが意図的に版を選ぶのは drift ではない。式そのものを違反に
  // すると、マトリクスを使うワークフローが永久に赤になる。
  test('${{ }} 式は判定しないこと', () => {
    expect(check('          bun-version: ${{ matrix.bunjs_version }}\n')).toHaveLength(0);
  });

  test('コメント行は判定しないこと', () => {
    expect(check('      # bun-version: latest — 以前の設定\n')).toHaveLength(0);
  });

  test('無関係な行に反応しないこと', () => {
    expect(
      check('      - name: Setup Bun\n        run: bun install --frozen-lockfile\n'),
    ).toHaveLength(0);
  });

  // action-setup 形式の判定を「version: を含む行」だけで書くと、無関係な
  // アクションの version をすべて誤検出する。だからアクション名を文脈に取る。
  test('pnpm/action-setup 以外の version: には反応しないこと', () => {
    expect(
      check(
        '      - uses: actions/setup-java@v4\n        with:\n          version: 17\n' +
          '      - uses: some/other-action@v1\n        with:\n          version: latest\n',
      ),
    ).toHaveLength(0);
  });

  test('action-setup 形式で一致していれば違反なし', () => {
    expect(
      check('        uses: pnpm/action-setup@v4\n        with:\n          version: 10.34.9\n'),
    ).toHaveLength(0);
  });

  test('action-setup の version が式なら判定しないこと', () => {
    expect(
      check(
        '        uses: pnpm/action-setup@v4\n        with:\n          version: ${{ matrix.pnpm }}\n',
      ),
    ).toHaveLength(0);
  });
});

// NOTE(#1349 review): the gap this half of the check closes. Step 1 froze the
// pnpm paths and left eleven `bun install` calls — the ordinary backend CI and
// the distribution build among them — so those jobs could resolve dependencies
// the committed bun.lock never recorded while the dedicated Frozen Install job
// stayed green. That job proves the lockfile is installable; it cannot stop
// another job from resolving something else.
describe('frozen install — 捕まえるべきもの', () => {
  test.each([
    ['bun', '        run: bun install\n'],
    ['pnpm', '        run: pnpm install\n'],
    ['npm', '        run: npm install\n'],
    ['npm ci', '        run: npm ci\n'],
    ['bun i', '      run: bun i\n'],
  ])('%s の非 frozen install', (_label, yaml) => {
    const found = checkFrozen(yaml);
    expect(found).toHaveLength(1);
    expect(found[0]!.tool).toBe('lockfile');
    expect(found[0]!.expected).toContain('--frozen-lockfile');
  });

  test('同一ファイル内の複数箇所をすべて報告すること', () => {
    expect(checkFrozen('        run: bun install\n        run: pnpm install\n')).toHaveLength(2);
  });

  test('行番号を正しく報告すること', () => {
    const found = checkFrozen('a\nb\n        run: bun install\n');
    expect(found[0]!.line).toBe(3);
  });
});

describe('frozen install — 見逃すべきもの', () => {
  test.each([
    ['frozen 付き bun', '        run: bun install --frozen-lockfile\n'],
    ['frozen 付き pnpm', '        run: pnpm install --frozen-lockfile\n'],
    ['パッケージ指定の install', '        run: bun install elysia\n'],
    ['install を含む別コマンド', '        run: bunx playwright install\n'],
    ['コメント内の記述', '        # run: bun install\n'],
    ['echo の中の記述', '        run: echo "cd rapitas-backend && bun install"\n'],
  ])('%s', (_label, yaml) => {
    expect(checkFrozen(yaml)).toHaveLength(0);
  });

  test('lockfile 更新ジョブは対象外（再解決がその目的）', () => {
    expect(checkFrozen('        run: bun install\n', 'update-lockfiles.yml')).toHaveLength(0);
  });
});
