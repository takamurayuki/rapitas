/**
 * reset-mocks.ts
 *
 * bun:mock の mock 関数を再帰的にリセットするユーティリティ。
 * 42 ファイルで重複宣言されている `resetAllMocks` 関数を一元化する。
 *
 * 特徴:
 * - ネストした mock オブジェクトを全深さでリセット（既存の2階層固定より安全）
 * - `mockReset` を持たない関数・非関数値は無害にスキップ
 * - `opts.afterReset` で `$transaction` 等の既定実装を復元するフックを提供
 * - 循環参照対策として深さ上限を設けている
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** resetDeepMocks のオプション */
export interface ResetMocksOptions {
  /**
   * 全 mock リセット完了後に呼ばれるコールバック。
   * `$transaction` のような高階モックに既定実装を復元する用途で使う。
   *
   * @example
   * resetDeepMocks(mockPrisma, {
   *   afterReset: () => {
   *     mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
   *   },
   * });
   */
  afterReset?: () => void;

  /**
   * 再帰の最大深さ（既定: 10）。
   * 循環参照や極端に深いオブジェクトによる無限ループを防ぐ。
   */
  maxDepth?: number;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** bun の mock 関数かどうかを判定する型ガード */
function isMockFunction(value: unknown): value is { mockReset: () => void } {
  return typeof value === 'function' && 'mockReset' in value;
}

/**
 * オブジェクトを再帰走査し、mock 関数を全てリセットする内部実装。
 *
 * @param node - 走査対象ノード
 * @param visited - 循環参照検出用セット / set for cycle detection
 * @param depth - 現在の深さ / current depth
 * @param maxDepth - 再帰上限 / recursion limit
 */
function walkAndReset(node: unknown, visited: Set<object>, depth: number, maxDepth: number): void {
  if (depth > maxDepth) return;
  if (node === null || node === undefined) return;

  if (isMockFunction(node)) {
    // mock 関数はリセットのみ。内部プロパティへの降下はしない
    node.mockReset();
    return;
  }

  if (typeof node === 'object') {
    if (visited.has(node)) return; // 循環参照スキップ
    visited.add(node);
    for (const value of Object.values(node)) {
      walkAndReset(value, visited, depth + 1, maxDepth);
    }
  }
  // 非オブジェクト・非関数値（string, number 等）は何もしない
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * mock オブジェクトを再帰的に走査し、全 mock 関数をリセットする。
 *
 * 既存の `resetAllMocks` 実装との違い:
 * - 2階層固定ではなく任意深さを走査（トップレベルの `$transaction` も拾える）
 * - 非 mock 値・非関数値を無害にスキップ
 * - `opts.afterReset` で高階モックの既定実装を復元可能
 *
 * @param root - リセット対象のルートオブジェクト / root object to reset
 * @param opts - オプション / options
 */
export function resetDeepMocks(root: unknown, opts?: ResetMocksOptions): void {
  const maxDepth = opts?.maxDepth ?? 10;
  const visited = new Set<object>();
  walkAndReset(root, visited, 0, maxDepth);
  opts?.afterReset?.();
}
