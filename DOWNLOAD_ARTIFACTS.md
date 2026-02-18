# CI/CDビルドアーティファクトのダウンロード方法

CI/CDパイプラインが正常に動作し、すべてのプラットフォーム向けのビルドが成功しました！

## 最新のビルド情報

- **ワークフローID**: 22137370966
- **ブランチ**: develop
- **ステータス**: ✅ 成功

## アーティファクトのダウンロード

### GitHub CLIを使用する場合

```bash
# 最新のビルドIDを確認
gh run list --workflow=tauri-build.yml --limit 1

# アーティファクトをダウンロード（すべて）
gh run download 22137370966

# 特定のアーティファクトのみダウンロード
gh run download 22137370966 -n rapitas-windows-x86_64-pc-windows-msvc
gh run download 22137370966 -n rapitas-linux-x86_64-unknown-linux-gnu
gh run download 22137370966 -n rapitas-macos-x86_64-apple-darwin
gh run download 22137370966 -n rapitas-macos-aarch64-apple-darwin
```

### GitHub Webインターフェースから

1. https://github.com/takamurayuki/rapitas/actions/runs/22137370966 を開く
2. ページ下部の"Artifacts"セクションから各プラットフォーム用のファイルをダウンロード

## 生成されるファイル

### Windows
- `.exe` - NSISインストーラー
- `.msi` - MSIインストーラー

### macOS
- `.dmg` - ディスクイメージ
- `.app` - アプリケーションバンドル

### Linux
- `.deb` - Debian/Ubuntuパッケージ
- `.rpm` - Red Hat/Fedoraパッケージ
- `.AppImage` - ポータブル実行ファイル

## リリースの作成

正式なリリースを作成する場合は、以下のようにタグを作成してプッシュしてください：

```bash
# バージョンタグを作成（v1.0.0の例）
git tag v1.0.0
git push origin v1.0.0
```

これにより、GitHub Releaseが自動的に作成され、すべてのプラットフォーム用のインストーラーが添付されます。

## CI/CDビルドの確認

```bash
# 最新のビルド状況を確認
gh run list --workflow=tauri-build.yml --limit 5

# 特定のビルドの詳細を確認
gh run view 22137370966
```