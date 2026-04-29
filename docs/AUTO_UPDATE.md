# Auto-Update Setup

Rapitas デスクトップ版は `tauri-plugin-updater` を使い、GitHub Releases に
公開された `latest.json` を起動時に取得して新バージョンを検出する。

## 1. 署名鍵の生成（初回のみ）

ローカルで一度だけ実行する。

```bash
# Tauri CLI で keypair を生成
pnpm dlx @tauri-apps/cli signer generate -w ~/.tauri/rapitas-updater.key
```

- 秘密鍵: `~/.tauri/rapitas-updater.key`（**絶対にコミットしない**。
  GitHub の Repository secrets `TAURI_SIGNING_PRIVATE_KEY` に登録する。
  パスフレーズを設定したなら `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` も。）
- 公開鍵: コマンド実行時に標準出力されるブロック。これを
  `rapitas-desktop/src-tauri/tauri.conf.json` の
  `plugins.updater.pubkey` に貼る。

## 2. リリース手順

```bash
# main / develop ブランチで
pnpm version <semver>            # package.json と tauri.conf.json をbump
git push --follow-tags
```

タグ `v*` のプッシュで `.github/workflows/tauri-build.yml` が走り、
全プラットフォームのバンドルと `latest.json` を含む GitHub Release を
作成する。

## 3. 配布フロー（更新先のクライアント）

1. アプリ起動時 `UpdateBanner` が
   `https://github.com/<repo>/releases/latest/download/latest.json` を取得
2. 現在のバージョンより新しければ右下にバナー表示
3. ユーザーが「今すぐ更新」を押すと
   - `*.sig` を公開鍵で検証
   - 検証成功時のみインストール → `relaunch()`
4. 「後で」を選ぶと `localStorage` に dismiss されたバージョンが残り、
   同じバージョンの間は再表示しない

## 4. 動作確認

- ローカル開発時: `tauri-plugin-updater` の `endpoints` に `file://` URL を
  指定すれば `latest.json` を手元のファイルから配ってテストできる。
- バナーは `isTauri()` ガードで Web ビルドでは無効。

## 5. ロールバック

GitHub Releases から該当 release を delete + 新しい
`latest.json` を旧バージョンに書き換えて pre-release などに上げ直す。
クライアントは次回起動時に旧 `latest.json` を取得して "新しいバージョンなし"
と判定するため、強制ロールバックには別途仕組みが必要。
