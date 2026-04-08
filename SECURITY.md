# Security Policy

## サポート対象バージョン / Supported Versions

最新の `develop` ブランチおよび最新リリースタグのみをサポートします。古いバージョンへのバックポートは原則行いません。

| Version            | Supported          |
| ------------------ | ------------------ |
| latest release     | :white_check_mark: |
| develop branch     | :white_check_mark: |
| older releases     | :x:                |

## 脆弱性の報告 / Reporting a Vulnerability

**脆弱性は公開 Issue では報告しないでください。**

GitHub の **Private vulnerability reporting** を使ってください:

1. リポジトリの **Security** タブを開く
2. **Report a vulnerability** をクリック
3. 再現手順・影響範囲・想定されるリスクを記載して送信

報告を受けたら、可能な限り速やかに(目安: 7 日以内)に初回応答します。修正がリリースされるまで、詳細を公開しないようご協力をお願いします。

## 対象 / In scope

- `rapitas-backend` (Elysia / Bun / Prisma)
- `rapitas-frontend` (Next.js)
- `rapitas-desktop` (Tauri / Rust)
- CI/CD ワークフロー (`.github/workflows/`)

## 対象外 / Out of scope

- 依存ライブラリ自体の脆弱性 (該当ライブラリの upstream へ)
- 開発用スクリプトや手元環境でのみ再現する問題
- ソーシャルエンジニアリング、物理アクセスを前提とした攻撃
