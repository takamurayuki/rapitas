# GEMINI.md

このリポジトリの AI エージェント運用ルールは [`AGENTS.md`](./AGENTS.md) に集約されています。Gemini CLI でも必ず `AGENTS.md` を読み込み、そこに書かれた共通制約に従って作業してください。

特に重要な制約:

- `rapitas-backend` のポート 3001 のプロセスを kill しない。
- `prisma generate` / `prisma db push` を手動実行しない。
- **git worktree 内で `npm install` / `bun install` / `pnpm install` を実行しない。** worktree の `node_modules` はメインチェックアウトへのリンクで共有されている。
- worktree に入ったら最初に `node scripts/setup-worktree.cjs` を実行する。これでテスト実行に必要な依存・Prisma 生成物・`.env` が揃う。

詳細は [`AGENTS.md`](./AGENTS.md) の「git worktree 運用ルール」セクションを参照。
