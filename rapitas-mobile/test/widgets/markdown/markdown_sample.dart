/// Shared Markdown fixture for the task description tests: one of every block
/// the task detail screen must render.
library;

const markdownSampleDescription = '''
# 見出し1
## 見出し2
### 見出し3

本文は **太字** と *斜体* と `inline code` を含む。
1行目
2行目

- 箇条書きA
- 箇条書きB
  - 入れ子

1. 番号付き1
2. 番号付き2

- [x] 完了したチェック項目
- [ ] 未完了のチェック項目

```dart
void main() {
  print('コードブロック');
}
```

> 引用ブロックの文章

[公式サイト](https://example.com/docs)

| 項目 | 値 |
| --- | --- |
| 優先度 | 高 |
| 見積もり | 2時間 |
''';
