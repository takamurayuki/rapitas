# Rapitas Desktop

Tauri v2を使用したRapitasのデスクトップアプリケーション版です。

## 必要条件

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- [Bun](https://bun.sh/) (バックエンド用)

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

これにより:
- Next.jsの開発サーバーが起動 (http://localhost:3000)
- バックエンドサーバーが自動起動 (http://localhost:3001)
- Tauriウィンドウが開きます

## ビルド

### 開発ビルド
```bash
pnpm run build
```

### リリースビルド
```bash
pnpm tauri build
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
