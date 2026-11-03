# Rapitas Desktop

Tauri v2を使用したRapitasのデスクトップアプリケーション版です。

## 必要条件

CI が使うバージョンは [`.github/toolchain.json`](../.github/toolchain.json) が正 (Node は [`.nvmrc`](../.nvmrc) にも記載)。

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) 24
- [pnpm](https://pnpm.io/) 10.34.9
- [Bun](https://bun.sh/) 1.3.13 (バックエンド用)

### Windows追加要件

- Microsoft Visual Studio C++ Build Tools
- WebView2 (Windows 10/11には標準搭載)

### macOS追加要件

- Xcode Command Line Tools (`xcode-select --install`)

## セットアップ

### 1. 依存関係のインストール

```bash
# rapitas-desktopディレクトリで
pnpm install

# rapitas-frontendディレクトリで
cd ../rapitas-frontend
pnpm install

# rapitas-backendディレクトリで
cd ../rapitas-backend
bun install
```

### 2. アイコンの生成

1024x1024以上の正方形PNG画像を用意し、以下を実行:

```bash
cd rapitas-desktop
npx tauri icon path/to/your-icon.png
```

### 3. 開発サーバーの起動

```bash
# rapitas-desktopディレクトリで
pnpm run dev
```

`pnpm run dev` は `node scripts/dev.js` を実行し、以下を行います:

- ポート 3001/3000 に残った rapitas のプロセスを停止
- SQLite 用 Prisma Client と初期化 SQL を生成 (`bun run db:prepare:sqlite`。スキーマ未変更ならスキップ)
- バックエンド (`bun run dev:stable`, http://localhost:3001) を起動し、続けて Next.js 開発サーバー (http://localhost:3000) を起動

Tauri ウィンドウも含めて起動する場合は `pnpm run tauri` (`tauri dev`) を使います。`src-tauri/tauri.conf.json` の `beforeDevCommand` が `node scripts/dev.js` を実行するため、上記のサーバー起動も同時に行われます。

## ビルド

### リリースビルド

```bash
pnpm run build   # tauri build --features custom-protocol -c src-tauri/tauri.build.conf.json
```

ビルド成果物は `src-tauri/target/release/bundle/` に出力されます:

- Windows: `.msi`, `.exe`
- macOS: `.dmg`, `.app`
- Linux: `.deb`, `.AppImage`

## アーキテクチャ

```
rapitas-desktop/
├── package.json          # Node.js依存関係
├── src-tauri/
│   ├── Cargo.toml        # Rust依存関係
│   ├── tauri.conf.json   # Tauri設定
│   ├── capabilities/     # 権限設定
│   ├── icons/            # アプリアイコン
│   └── src/
│       └── main.rs       # Rustエントリーポイント
```

## Web版との違い

- **バックエンド**: デスクトップ版はアプリ起動時にバックエンドを自動起動
- **セキュリティ**: ローカルで動作するため、APIキーなどがサーバーに送信されない
- **パフォーマンス**: WebView2/WKWebViewを使用し、ネイティブに近い速度
- **オフライン**: バックエンドがローカルで動作するため、ネット接続不要（AIエージェント実行時を除く）

## トラブルシューティング

### Rustがインストールされていない

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### WebView2エラー (Windows)

https://developer.microsoft.com/en-us/microsoft-edge/webview2/ からダウンロード

### バックエンドが起動しない

`rapitas-backend` ディレクトリで直接起動してエラーを確認:

```bash
cd ../rapitas-backend
bun run dev
```
