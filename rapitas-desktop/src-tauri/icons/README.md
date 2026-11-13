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

## 小サイズ用マスター（16〜48px）

`app-icon.svg` をそのまま縮小すると、16〜32px ではタスク行が潰れて読めません。そのため小さいサイズは別のマスターから描いています。

| マスター | 使うサイズ | 内容 |
| --- | --- | --- |
| `app-icon.svg` | 64px 以上（`icon.png`、`128x128*.png`、`64x64.png`、`Square71x71Logo.png` 以上、`StoreLogo.png`、ico の 64/128/256、icns の ic12 以上） | 通常の意匠 |
| `app-icon-small.svg` | 24〜48px（`32x32.png`、`Square30x30Logo.png`、`Square44x44Logo.png`、ico の 24/32/48、icns の ic11） | 3 行を太く大きくし、傾きを -10° から -6° に弱めたもの |
| `app-icon-small-16.svg` | 16〜20px（ico の 16/20） | 2px の行を 16px のピクセル格子に揃え、傾きをなくしたもの |
| `tray-icon.svg` | `tray-icon.png` | `app-icon-small.svg` と同じ形をトレイ用の配色にしたもの |

システムトレイは `src/app_setup.rs` が `32x32.png` を読み込んで表示します。

`npx tauri icon` は 1 つのソースから全サイズを作り直すため、実行すると上の小サイズが通常の意匠に戻ります。実行したあとは、小サイズのファイルと、`icon.ico` / `icon.icns` の該当フレームだけを小サイズ用マスターから描き直して差し替えてください。64px 以上のフレームはそのまま残します。
