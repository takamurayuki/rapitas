# PR Endpoint Guard Pattern

PR 操作エンドポイントにおける「事前ガード→ビジネスロジック実行」の標準化パターン。

## 背景と目的

`PATCH /pull-requests/:id/base` の実装で確立した prNumber 整合性チェック(422) と
state 事前チェック(409) のパターンを、すべての PR 操作エンドポイントへ横展開し、
API 品質の一貫性と実装漏れ防止を実現する。

## 適用対象エンドポイント

| エンドポイント | ガード設定 | 理由 |
|---|---|---|
| `POST /pull-requests/:id/approve` | `requireOpen: true` | merged/closed PR へのレビューは GitHub API が拒否 |
| `POST /pull-requests/:id/request-changes` | `requireOpen: true` | 同上 |
| `POST /pull-requests/:id/merge` | `requireOpen: true` | 二重マージを防止 |
| `PATCH /pull-requests/:id/base` | `requireOpen: true` | base 変更は open PR にのみ有効 |
| `POST /pull-requests/:id/comments` | `requireOpen: false` | merged PR へのコメントは GitHub が受理する |

## ガードの仕組み

`services/github/pr-guards.ts` の `checkPrActionable()` が2段階の検査を行う。

### 1. prNumber 整合性チェック → 422

```
条件: !Number.isInteger(pr.prNumber) || pr.prNumber <= 0
```

不正な prNumber で gh CLI を呼ぶと無意味な外部呼び出しが発生するため、
Unprocessable Entity (422) で事前に弾く。

### 2. state 事前チェック → 409

```
条件: requireOpen && pr.state !== 'open'
```

merged/closed PR への操作は競合状態。GitHub API 自体が拒否するが、
事前に 409 Conflict を返すことで UX を向上させる。

## 実装テンプレート

新規 PR 操作エンドポイントを追加する際は、以下のテンプレートに従う。

```typescript
.post('/pull-requests/:id/your-operation', async (context) => {
  const { id } = context.params as { id: string };

  // Step 1: DB から PR レコードを取得
  const pr = await prisma.gitHubPullRequest.findUnique({
    where: { id: parseInt(id) },
    include: { integration: true },
  });
  if (!pr) {
    context.set.status = 404;
    return { success: false, error: 'PR not found' };
  }

  // Step 2: 事前ガード (prNumber整合性 + state チェック)
  // requireOpen: true  → open PR にのみ許可される操作 (approve, merge, etc.)
  // requireOpen: false → merged PR でも許可される操作 (comments)
  const guard = checkPrActionable(pr, { operationLabel: 'あなたの操作名', requireOpen: true });
  if (guard) {
    context.set.status = guard.status; // 422 または 409
    return guard.body;
  }

  // Step 3: ビジネスロジック実行
  const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
  await githubService.yourOperation(repo, pr.prNumber, /* ... */);

  return { success: true };
})
```

## エラーレスポンス仕様

### 422 Unprocessable Entity — prNumber 不正

```json
{
  "success": false,
  "error": "PRの番号が不正なため base変更 を実行できません (prNumber=0)"
}
```

### 409 Conflict — PR が open 状態でない

```json
{
  "success": false,
  "error": "PRがopen状態ではないため base変更 を実行できません (state=merged)"
}
```

### 404 Not Found — PR レコードが存在しない

```json
{
  "success": false,
  "error": "PR not found"
}
```

## ガード関数のシグネチャ

```typescript
/**
 * PR が指定操作を実行可能な状態かを検査する。
 * @param pr - prNumber と state を持つ PR レコード
 * @param opts.operationLabel - エラーメッセージ用の操作名 (例: 'base変更')
 * @param opts.requireOpen - true の場合 state!=='open' を 409 で弾く
 * @returns PrGuardViolation when a guard fires, null when the PR is actionable.
 */
function checkPrActionable(
  pr: { prNumber: number; state: string },
  opts: { operationLabel: string; requireOpen: boolean },
): PrGuardViolation | null
```

## 設計上の決定事項

### なぜ Elysia フック (`beforeHandle`) ではなくヘルパー関数か

`beforeHandle` を使うと `context.pr` という暗黙依存が生まれ、ルート実装の可読性が低下する。
また、フックに PR 未取得時の分岐が隠蔽されてデバッグが困難になる。
ヘルパー関数方式は `github.ts` の既存インラインスタイルと統一でき、単体テストも容易。

### なぜヘルパーは `context.set.status` を直接設定しないか

Elysia の `context` に依存するとヘルパーの単体テストがモック無しに書けなくなる。
純粋関数として `PrGuardViolation | null` を返し、呼び出し側でステータスを設定することで
テスト容易性と既存コードスタイルの一貫性を両立する。

## 関連ファイル

- `services/github/pr-guards.ts` — ガード関数の実装
- `services/github/pr-guards.test.ts` — ガード関数の単体テスト
- `routes/social/github.ts` — 適用済みエンドポイント
- `tests/routes/social/github-routes.test.ts` — 統合テスト
