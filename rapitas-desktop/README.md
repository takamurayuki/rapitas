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

### 2. アイコン

アイコンはリポジトリに含まれているため、通常は生成し直す必要はない。元画像 `src-tauri/icons/app-icon-master.png` を変えた場合は `scripts/render-small-icons.py` で各サイズを描き直す。手順と出力先は [`src-tauri/icons/README.md`](src-tauri/icons/README.md) を参照。

### 3. 開発サーバーの起動

```bash
# rapitas-desktopディレクトリで
pnpm run dev
```

`pnpm run dev` は `node scripts/dev.js` を実行し、以下を行います:

- チェックアウトをプライマリブランチ（`RAPITAS_PRIMARY_BRANCH`、既定 `develop`）に固定し、upstream へ fast-forward する（`scripts/dev-pull.cjs`。作業ツリーが dirty・分岐・オフラインのときは理由を表示してスキップ。`--no-pull` で無効）
- ポート 3001/3000 に残った rapitas のプロセスを停止
- SQLite 用 Prisma Client と初期化 SQL を生成 (`bun run db:prepare:sqlite`。スキーマ未変更ならスキップ)
- バックエンド (`bun run dev:stable`, http://localhost:3001) を起動し、続けて Next.js 開発サーバー (http://localhost:3000) を起動

Tauri ウィンドウも含めて起動する場合は `pnpm run tauri`（`scripts/dep-sync.cjs --only desktop` の後に `tauri dev`）を使います。`src-tauri/tauri.conf.json` の `beforeDevCommand` が `node scripts/dev.js` を実行するため、上記のサーバー起動も同時に行われます。

## ビルド

### リリースビルド

```bash
pnpm run build   # tauri build --features custom-protocol -c src-tauri/tauri.build.conf.json
```

ビルド成果物は `src-tauri/target/release/bundle/` に出力されます:

- Windows: `.msi`, `.exe`
- macOS: `.dmg`, `.app`
- Linux: `.deb`, `.rpm`

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
│       ├── main.rs       # Rustエントリーポイント
│       ├── sidecar_launch.rs, sidecar_policy.rs, sidecar_job.rs  # バックエンド sidecar の起動と監視
│       ├── terminal.rs   # 統合ターミナルの PTY
│       ├── app_icon.rs   # トレイ・ウィンドウアイコン
│       └── ...           # ショートカット、音声入力、ポモドーロ窓など
```

Rust 側に置く責務（OS とプロセス寿命に関わる処理だけ）は [ADR-0010](../docs/adr/0010-desktop-rust-boundary.md) で決めている。

## Web版との違い

- **バックエンド**: リリースビルドはバックエンドを sidecar として起動し監視する。終了すると back-off を挟んで再起動し（終了コード 75 は即時）、2 分間に 5 回落ちたら再起動をやめて通知する（`src-tauri/src/sidecar_policy.rs`）。Windows では Job Object に入れ、アプリ終了時に子プロセスごと止まる
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
