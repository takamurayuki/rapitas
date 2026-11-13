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
| `scripts/render-small-icons.py` | 16〜48px の小サイズ（`icon.ico` の 16/20/24/32/48 フレーム、`32x32.png`、トレイ用 `tray-icon-{16,20,24,32}.png`＝タイルなしの紫の図形）。傾けた図形は小サイズで縁がにじむため、同じ構成を水平・整数ピクセルで描き直している。64px 以上は `app-icon.svg` のまま |

図形はスマホ版アイコン（`rapitas-mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png`）と同じ構成です。
スマホ版は全面塗りで、デスクトップ版はそこに角丸タイル（`rx=213`）をかけただけです。図形を縮小しないでください。タイルの内側はスマホ版と 1px 単位で一致します。

システムトレイは `src/app_icon.rs` がモニターの拡大率に合う `tray-icon-<size>.png` を選んで表示します（タイルなしの紫の図形だけ。16px の枠を図形で埋められ、明暗どちらのタスクバーでも見える。OS に 256px から縮小させると図形が崩れるため、実寸の画像を渡します）。`app-icon.svg` の図形を変えたら `python rapitas-desktop/scripts/render-small-icons.py` を再実行してください。
