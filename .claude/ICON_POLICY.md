# ICON CONSISTENCY POLICY

## PRIME DIRECTIVE

One icon = one meaning, app-wide.

- **Same meaning → reuse the same icon.** Consistency aids recognition.
- **Different meaning → use a different icon.** Never reuse an icon that already
  stands for another concept; doing so hurts scannability and breaks the user's
  intuitive "this glyph means X" mental model.

A glyph is part of the UI's vocabulary. Two unrelated meanings sharing one glyph
is as confusing as two unrelated functions sharing one name.

---

## 1. DECISION TREE — Before adding an icon

```
What concept does this icon represent here?
├── Is that concept already shown with an icon elsewhere?
│     └── YES → reuse THAT icon (same meaning → same glyph).
└── Is the glyph I want to use already used for a DIFFERENT concept?
      ├── YES → pick a different glyph (different meaning → different icon).
      └── NO  → OK to use it; it now "owns" this meaning.
```

---

## 2. HOW TO CHECK (do this every time)

1. **Search the glyph** you intend to use — is it already imported anywhere for
   a different purpose?
   `grep -rn "Bug" src --include=*.tsx`
2. **Search the concept** — does an icon already represent it? Reuse that one.
3. When unsure, prefer a distinct, conventional glyph over an overloaded one.

---

## 3. ESTABLISHED MEANINGS (living reference — extend as you add)

Keep this list accurate. If you assign a glyph a new meaning, add it here.

| Glyph (lucide)            | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `Lightbulb`               | アイデア (idea box / an idea)            |
| `Inbox`                   | 「バックログ」ナビ群                     |
| `Bug`                     | 懸念バックログ / 懸念の種別「バグ」      |
| `Wrench`                  | 懸念の種別「リファクタ」                 |
| `ShieldAlert`             | 懸念の種別「セキュリティ」               |
| `Feather`                 | 複雑度「軽量」                           |
| `Layers`                  | 複雑度「詳細」                           |
| `FlaskConical`            | ワークフローの「検証」フェーズ           |
| `ListTodo`                | サブタスク                               |
| `CheckCircle2`            | 完了したワークフロータブ                 |
| `PriorityIcon` (chevrons) | タスク/アイデアの優先度                  |
| `Globe`                   | スコープ「グローバル」                   |
| `FolderOpen`              | プロジェクト / カテゴリ                  |
| `Scale`                   | 意思決定 / デシジョンジャーナル          |
| `SquareTerminal`          | 統合ターミナル                           |
| `SplitSquareHorizontal`   | ターミナルのペイン左右分割               |
| `SplitSquareVertical`     | ターミナルのペイン上下分割               |

### Known collisions — resolve when you next touch them

| Glyph   | Conflicting meanings                                   |
| ------- | ------------------------------------------------------ |
| `Gauge` | 複雑度「標準」 **と** 懸念の種別「パフォーマンス」     |

> When you edit either site above, give one of them a different glyph so a
> single icon stops carrying two meanings.

---

## 4. ANTI-PATTERNS — Never do these

```tsx
// ❌ Same glyph, two unrelated meanings
<CheckCircle2 />  // here: "completed"
<CheckCircle2 />  // elsewhere: "selected" — pick CheckSquare / Check instead

// ❌ Reaching for a glyph already owned by another concept
<Lightbulb />     // already = "idea"; don't reuse it for "tip/hint/insight"

// ✅ Distinct meanings, distinct glyphs
<Lightbulb />     // idea
<Bug />           // concern / bug
```

---

## QUICK REFERENCE

```
Adding an icon?
  Same meaning as an existing icon?   → reuse that icon
  Glyph already means something else? → choose a different glyph
  New, unused glyph for a new meaning → OK; record it in §3
Never: one glyph for two unrelated meanings.
```
