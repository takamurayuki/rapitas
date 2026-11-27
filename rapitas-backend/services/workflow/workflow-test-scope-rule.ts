/**
 * workflow-test-scope-rule
 *
 * The ja/en rule that tells the implementer and the verifier which tests to
 * run: the changed files' tests and the tests that import them directly, one
 * file per run, and never the whole suite. Does not choose or run tests.
 */

// NOTE: 2026-11-28, task 1542's verifier ran the whole backend suite (about
// 1,000 files, before and after, four at a time) three rounds in a row. Hung
// runs piled up as bun processes and the verify phase never finished. The
// whole suite is CI's job; verification checks what the change touches.

/** Test scope rule for the implementer (ja). */
export const TEST_SCOPE_RULE_IMPLEMENTER_JA =
  '- **実行するテストは、変更したファイルのテストと、変更したファイルを直接 import しているテストだけです。スイート全体やディレクトリ全体のテストは実行しないでください**（全体は CI が受け持ちます。全体を流すスクリプトを自分で書くことも禁止です）。テストは**ファイル単位** (`bun test --isolate <1ファイル>`) で行ってください。bun の `mock.module` は**プロセスグローバル**なので、同じモジュールを mock する複数のテストファイルを**同時実行すると mock が衝突して偽の失敗**になります。これは bun の制約でありコードのバグではありません。**各ファイルが単体で通れば十分**です。複数テストファイルを「同時に通す」ためにモックの順序変更や beforeAll 化を延々と試みないでください（解決不能であり、時間を浪費します）。\n';

/** Test scope rule for the verifier (ja). */
export const TEST_SCOPE_RULE_VERIFIER_JA =
  '- **実行するテストは、変更したファイルのテストと、変更したファイルを直接 import しているテストだけです。スイート全体やディレクトリ全体のテストは実行しないでください**（全体は CI が受け持ちます。完了条件に「すべてのテスト」とあっても、この範囲で判定し、その旨を verify.md に書いてください）。変更前との比較は、そのうち変更前からあるファイルを変更前のコードで1回だけ実行して行います。bun のテストは **ファイル単位で実行・判定** してください (`bun test --isolate <1ファイル>`)。`mock.module` はプロセスグローバルのため、同じモジュールを mock する複数ファイルを**同時実行すると偽の失敗**が出ます。**各ファイルが単体で通れば「通過」と判定**してください（同時実行の失敗は bun の制約であり実装の不具合ではありません。検証ゲートも個別ファイルで実行します）。\n';

/** Test scope rule for the implementer (en). */
export const TEST_SCOPE_RULE_IMPLEMENTER_EN =
  "- **Run only the tests of the changed files and the test files that import them directly — never run the whole suite or a whole directory** (CI covers the whole suite; do not write your own script that runs everything either). **Verify tests PER FILE** (`bun test --isolate <one-file>`). Bun's `mock.module` is PROCESS-GLOBAL, so two test files that mock the same module conflict and produce FALSE failures when run together. That is a bun limitation, not a code bug. **Each file passing in isolation is sufficient.** Do NOT keep reordering mocks or moving imports into beforeAll trying to make multiple test files pass together — it is unsolvable and wastes time.\n";

/** Test scope rule for the verifier (en). */
export const TEST_SCOPE_RULE_VERIFIER_EN =
  '- **Run only the tests of the changed files and the test files that import them directly — never run the whole suite or a whole directory** (CI covers the whole suite; even when a criterion says "all tests", judge it on this scope and say so in verify.md). For a before/after comparison, run the pre-existing files among them once against the code before the change. Run and judge bun tests **PER FILE** (`bun test --isolate <one-file>`). `mock.module` is process-global, so running multiple files that mock the same module together yields FALSE failures. **Treat each file passing in isolation as a pass** (the failure-when-combined is a bun limitation, not an implementation defect; the verification gate also runs files individually).\n';
