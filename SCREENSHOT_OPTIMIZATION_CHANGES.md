# スクリーンショット取得の最適化

## 変更内容

### 1. `hasUIChanges`関数の厳格化
- **変更前**: すべての.tsx/.jsx/.css/.scssファイルを対象
- **変更後**: 以下のファイルのみを対象：
  - ページコンポーネント（page.tsx, *Client.tsx）
  - レイアウトファイル（layout.tsx）
  - ルートコンポーネント（App.tsx, index.tsx）
  - グローバルCSS（globals.css, index.css）
  - feature内の主要コンポーネント（*Panel.tsx, *View.tsx, *Page.tsx）

- **除外されるファイル**:
  - 共通コンポーネント（components/common/, components/ui/）
  - ユーティリティ（utils/, helpers/, lib/）
  - フック・ストア（hooks/, stores/）
  - 型定義・テスト（*.d.ts, *.test.*, *.spec.*）

### 2. `detectAffectedPages`関数の改善
- **変更前**: featureディレクトリの変更で複数ページを対象
- **変更後**:
  - feature変更は代表的な1ページのみ対象
  - 主要コンポーネント（Panel/View/Page/Client系）のみ検出
  - 同一featureの重複処理を防止

### 3. 最大ページ数の削減
- `captureScreenshotsForDiff`: 5 → 3ページ
- `captureAllScreenshots`: 10 → 5ページ

### 4. featureマッピングの簡素化
- 各featureで最も代表的な1ページのみをマッピング
- developer-mode → /approvals のみ
- tasks → / (ホーム) のみ
- calendar → /calendar のみ

## 効果
- 不要なスクリーンショットを大幅に削減
- UIに直接関係ないファイルの変更時はスクリーンショットを取得しない
- 1回の実行で取得されるスクリーンショット数を制限
- パフォーマンスの向上と実行時間の短縮

## 注意事項
- 重要なUIの変更が見逃されないよう、ページコンポーネントやレイアウトの直接的な変更は確実に検出される
- 必要に応じて、特定のコンポーネントパターンを追加できるよう拡張可能な実装