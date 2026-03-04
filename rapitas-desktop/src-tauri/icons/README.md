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
