/**
 * check-toolchain-drift ユニットテスト
 *
 * ツールチェーン固定の判定を検証する。
 *
 * このチェック自体が「走っているが何も測っていないゲート」になりうるので、
 * 捕まえるべきものを捕まえ、捕まえてはいけないものを見逃すことの両方を固定する。
 */
import { describe, test, expect } from 'bun:test';
import { findToolchainViolations } from './check-toolchain-drift';

const TC = { bun: '1.3.13', pnpm: '10.34.9', node: '24' };

/** Run the checker over a YAML fragment. */
function check(yaml: string) {
  return findToolchainViolations(yaml, 'w.yml', TC);
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
});
