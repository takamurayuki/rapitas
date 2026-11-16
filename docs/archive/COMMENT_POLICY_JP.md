# AIエージェント向けコメントポリシー

## 最重要原則

「何をするか」ではなく「なぜそうするか」を書く。
コードをそのまま言い換えただけのコメントは削除する。

---

## 判断フロー — コメントを書くべきか？

```
対象はファイル・公開関数・エクスポートされた型か？
├── YES → ドキュメントコメントを書く（セクション2参照）
└── NO  → 以下のいずれかに該当するか？
           ├── A) この実装を選んだ理由がコードから読み取れない
           ├── B) 外部仕様やAPIに起因する制約がある
           ├── C) 「改善」しようとした将来の編集者がこれを壊す可能性がある
           └── D) 既知の問題・暫定対応・未実装の作業である
               ├── いずれかに該当 → インラインコメントを書く（セクション3参照）
               └── すべて非該当  → コメントを書かない
```

---

## 1. 言語別ルール

| 言語                    | ファイルヘッダー | 公開関数           | 型・インターフェース       |
| ----------------------- | ---------------- | ------------------ | -------------------------- |
| TypeScript / JavaScript | `/** ... */`     | JSDoc `/** ... */` | フィールドごとにJSDoc      |
| Rust                    | `//! ...`        | `/// ...`          | フィールドごとに `/// ...` |
| Python                  | `""" ... """`    | docstring          | インライン `#`             |
| Go                      | `// Package ...` | `// 関数名 ...`    | `// フィールド名 ...`      |

**ドキュメントコメントはすべて英語で書く。**
`@param` / `@returns` / `@throws` の説明にのみ日本語訳を併記する。

---

## 2. ドキュメントコメントのテンプレート

### ファイルヘッダー（全ファイル必須・例外なし）

```typescript
/**
 * <モジュール名>
 *
 * <このモジュールが担う責務を一文で。>
 * <自明でない場合、担わない責務を一文で。>
 */
```

```rust
//! <モジュール名>
//!
//! <このモジュールが担う責務を一文で。>
```

```python
"""
<module_name>.py

<このモジュールが担う責務を一文で。>
"""
```

### 公開関数

**以下のいずれかに該当する場合、JSDoc/rustdocを書く：**

- 引数が1つ以上ある
- 戻り値が `void` / `()` / `None` ではない
- throw / エラー返却の可能性がある

**省略してよい条件：** 関数名と型だけで意図が完全に伝わり、かつ上記のいずれにも該当しない場合のみ。

```typescript
/**
 * <実装方法ではなく目的を一文で。>
 *
 * @param paramName - <何か> / <日本語説明>
 * @returns <何を返すか> / <日本語説明>
 * @throws {ErrorType} <いつthrowするか> / <日本語説明>
 */
```

```rust
/// <目的を一文で。>
///
/// # Arguments
/// * `param` - <何か> / <日本語説明>
///
/// # Errors
/// Returns `ErrorType` when <condition>. / <条件>の場合に返す。
```

```python
def func(param: str) -> int:
    """
    <目的を一文で。>

    Args:
        param: <何か> / <日本語説明>

    Returns:
        <何を返すか> / <日本語説明>

    Raises:
        ValueError: <いつ> / <条件>
    """
```

---

## 3. インラインコメントのルール

### 書き方

```
// <理由を一文で。>（必要であれば背景を補足）
```

### 良い例・悪い例

```typescript
// ❌ 禁止 — コードをそのまま言い換えている
const count = agents.length; // agentsの長さを取得

// ✅ 必須 — なぜそうするかを説明している
const count = agents.length; // ループのたびにO(n)になるのを避けるためキャッシュ

// ❌ 禁止 — 自明な初期化
let retries = 0; // 0で初期化

// ✅ 必須 — 外部仕様に起因する制約
const MAX_TOKENS = 8192; // Claude APIのsystem promptハード上限

// ❌ 禁止 — 呼び出しをそのまま説明している
await agent.stop(); // stopを呼ぶ

// ✅ 必須 — 自明でない順序や副作用
await agent.stop(); // ポート解放前に完了必須。stop()は冪等でないため順序が重要
```

---

## 4. タグ規約

使用するタグは以下の4種類のみ。

| タグ    | 用途                                 |
| ------- | ------------------------------------ |
| `TODO`  | 後で対応が必要な作業                 |
| `FIXME` | 既知の不具合・誤った挙動             |
| `NOTE`  | 将来の編集者が必ず知るべき重要な背景 |
| `HACK`  | 暫定対応・必ず再検討が必要な箇所     |

```typescript
// TODO: サマライズのフォールバック未実装 — 大きなタスクでコンテキスト超過する。
// FIXME: スレッドセーフでない — シングルスレッド前提の実装。
// NOTE: Claude APIは高負荷時に529を返す — リトライ処理は意図的なもの。
// HACK: pino v9破壊的変更の回避策 — v10へのアップグレード後に戻すこと。
```

---

## 5. エージェント固有の義務

### 5-1. 変更した理由を必ず残す

```typescript
// NOTE: Replaced forEach with for...of — await is not supported inside forEach callbacks.
for (const agent of agents) {
  await agent.stop();
}
```

### 5-2. 削除した理由を必ず残す

```typescript
// NOTE: Removed null check — TypeScript strict mode guarantees non-null at this call site.
```

### 5-3. 不確実な実装にはすぐにフラグを立てる

```typescript
// FIXME: Spec undefined for empty agentId — currently falls back to auto-select.
```

### 5-4. 外部仕様への依存をすべて注記する

```typescript
// NOTE: pino v9+ changed default log level from 'info' to 'trace'. Pin version if behavior changes.
// NOTE: freee API rate limit is 500 req/min per token. Batch calls accordingly.
```

---

## 6. アンチパターン — 絶対にやらないこと

```typescript
// ❌ 編集履歴をコメントに残す — gitを使う
// 2025-01-01 更新

// ❌ 自明な型の説明
const name: string = "rapitas"; // string

// ❌ 理由なしのコードアウト
// await agent.reset();

// ✅ 理由ありのコードアウト
// await agent.reset(); // NOTE: Disabled — reset() clears token budget mid-task. Re-enable after #142.

// ❌ 曖昧なTODO
// TODO: あとで直す

// ✅ 具体的で実行可能なTODO
// TODO: Add exponential backoff — currently fails immediately on rate limit (HTTP 429).
```

---

## クイックリファレンス

```
ファイルを作成した？        → ファイルヘッダーを追加する（常に必須）
公開関数？                  → ドキュメントコメントを追加する（引数 / 戻り値 / throwがある場合）
コードの意図が自明でない？  → インラインの「なぜ」コメントを追加する
コードを変更した？          → 変更箇所の直上にNOTEを追加する
コードを削除した？          → 理由をNOTEで残す
仕様が不明確？              → FIXMEを追加する
暫定対応？                  → HACKを追加する
自明なコード？              → 何も書かない
```
