# Auto-Update Setup

> **現状: 自動更新は無効化されている (#978)。** `tauri-plugin-updater` は
> 依存する `zip` crate の脆弱性 (RUSTSEC-2026-0367/-0368/-0369) が上流で
> 解消されるまで `rapitas-desktop/src-tauri/Cargo.toml` から削除されており、
> `rapitas-frontend/src/components/common/UpdateBanner.tsx` の
> `UPDATER_ENABLED` も `false`。復活させるときは、プラグイン依存・
> capability・`plugins.updater` 設定・`UPDATER_ENABLED` をまとめて戻す
> (Cargo.toml の NOTE 参照)。以下はその復活後の手順と配布フロー。
> リリースワークフローは現在も `latest.json` を生成している。

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
  `plugins.updater.pubkey` に貼る (このキーは無効化に伴い現在は削除されている)。

## 2. リリース手順

```bash
# ルートで: ルート package.json の version を設定し、全マニフェスト
# (rapitas-desktop/package.json, tauri.conf.json, tauri.ci.conf.json, Cargo.toml) に同期
node scripts/sync-version.cjs <semver>
git commit -am "chore(repo): release v<semver>"
git tag v<semver>
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
