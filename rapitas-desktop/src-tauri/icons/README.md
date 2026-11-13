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
| `app-icon.svg` | アプリアイコンの 64px 以上（`*.png`、`icon.ico` の 64/128/256 フレーム、`icon.icns` の全フレーム） |
| `scripts/render-small-icons.py` | 16〜48px の小サイズ（`icon.ico` の 16/20/24/32/48 フレーム、`32x32.png`、トレイ用 `tray-icon-{16,20,24,32}.png`）。傾けた図形をそのまま縮小すると縁がにじむため、同じ傾きの図形を行を少し太くし、縁が最もくっきりする位置にずらして描き直している。64px 以上は `app-icon.svg` のまま |

図形はスマホ版アイコン（`rapitas-mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png`）と同じ構成です。
スマホ版は全面塗りで、デスクトップ版はそこに角丸タイル（`rx=213`）をかけただけです。図形を縮小しないでください。タイルの内側はスマホ版と 1px 単位で一致します。

システムトレイは `src/app_icon.rs` がモニターの拡大率に合う `tray-icon-<size>.png` を選んで表示します（アプリアイコンと同じ紫のタイル＋白の図形。小さい枠で読めるよう図形を約1.2倍に拡大し角丸を少し詰めている。OS に 256px から縮小させると図形が崩れるため、実寸の画像を渡します）。`app-icon.svg` の図形を変えたら `python rapitas-desktop/scripts/render-small-icons.py` を再実行してください。
