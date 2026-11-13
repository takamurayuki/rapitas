# アイコンの生成

Tauriのビルドには以下のアイコンファイルが必要です：

- `32x32.png` - 32x32ピクセル
- `128x128.png` - 128x128ピクセル
- `128x128@2x.png` - 256x256ピクセル (Retina用)
- `icon.icns` - macOS用
- `icon.ico` - Windows用

## 自動生成方法

1. 1024x1024以上の正方形PNG画像を用意
2. Tauri CLIでアイコンを生成:

```bash
cd rapitas-desktop
npx tauri icon path/to/your/icon.png
```

これにより、すべての必要なサイズが自動生成されます。

## マスターと図形の構成

| マスター | 用途 |
| --- | --- |
| `app-icon.svg` | アプリアイコンのすべてのサイズ（`*.png`、`icon.ico` の全フレーム、`icon.icns` の全フレーム） |
| `tray-icon.svg` | `tray-icon.png`（64x64・透過。トレイ専用。同じ図形を黒のベタ塗りにし、タイルなしで横約88%まで中央基準で拡大したもの） |

図形はスマホ版アイコン（`rapitas-mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png`）と同じ構成です。
スマホ版は全面塗りで、デスクトップ版はそこに角丸タイル（`rx=213`）をかけただけです。図形を縮小しないでください。タイルの内側はスマホ版と 1px 単位で一致します。

システムトレイは `src/app_setup.rs` が `tray-icon.png` を読み込んで表示します（macOS ではテンプレート画像として扱い、メニューバーの明暗に合わせて OS が色を反転します）。アプリアイコンの `32x32.png` はトレイには使いません。
