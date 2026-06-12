# GlobalErrorReporter — 無害エラーフィルタ戦略

> **対象ファイル**: `rapitas-frontend/src/components/common/GlobalErrorReporter.tsx`
> **設定ファイル**: `rapitas-frontend/src/config/benign-error-patterns.ts`
> **関連タスク**: #217 (フィルタ導入), #218 (拡張可能性設計, 発見元: #190)

---

## 1. 背景と目的

`GlobalErrorReporter` はブラウザの uncaught error / unhandled rejection を `POST /system/errors` へ転送し、アプリ内の「最近のエラー」パネルと Sentry に届けるコンポーネントです。

ブラウザ環境では、アプリケーションとは無関係な **既知の無害エラー** が定期的に発火します。これらをすべて報告すると以下の問題が生じます:

- `/system/errors` リングバッファが本物のエラーを押し出す
- Sentry のアラートがノイズで埋まり、実際の障害を見逃す
- 開発者が繰り返し「これは本当に問題か?」を判断する認知コストが発生する

`BENIGN_ERROR_PATTERNS` 定数と `isBenign()` 関数はこの問題を解決するために導入されました。

---

## 2. アーキテクチャ概要

```
src/config/benign-error-patterns.ts   ← 設定の単一ソース (パターン定義 + matchesPattern)
         │
         │ import
         ▼
src/components/common/GlobalErrorReporter.tsx
         │  isBenign(message, ctx?)
         │
         ▼
    send(payload)  →  isBenign?  → YES → 抑制 (fetch しない)
                          │
                          NO
                          │
                    shouldReport?  → NO → 重複除去
                          │
                         YES
                          │
                    POST /system/errors
```

### 設計ファイルの役割分担

| ファイル | 責務 |
|---------|------|
| `benign-error-patterns.ts` | `BenignErrorPattern` 型・`BENIGN_ERROR_PATTERNS` 定数・`matchesPattern()` ヘルパ |
| `GlobalErrorReporter.tsx` | `isBenign()` 公開 API・`send()` 内の実際の抑制フロー・ブラウザイベントリスナー |

新しいパターンを追加する場合は **`benign-error-patterns.ts` のみ** を変更します。`GlobalErrorReporter.tsx` の変更は不要です。

---

## 3. BenignErrorPattern 型

```typescript
interface BenignErrorPattern {
  pattern: string;        // マッチ対象文字列
  mode?: 'prefix' | 'contains';  // マッチ方式 (デフォルト: 'prefix')
  ua?: string;            // UA サブストリング (省略時: 全 UA で有効)
  env?: string[];         // NODE_ENV リスト (省略時: 全環境で有効)
  note: string;           // 必須: なぜ無害かの説明
}
```

### mode の選択基準

| mode | 使うとき | 使わないとき |
|------|---------|-------------|
| `'prefix'` (デフォルト) | エラーメッセージが特定の固定文字列から始まる場合 | — |
| `'contains'` | ターゲット文字列がメッセージ先頭に来ない場合のみ | 先頭から始まるなら `prefix` が安全 |

**原則として `prefix` を使う。** `contains` は意図しないメッセージを抑制するリスクが高い。

### ua フィールドの方針（部分一致・正規表現不採用）

UA フィルタは `navigator.userAgent.includes(entry.ua)` で評価します（部分一致）。

正規表現を採用しない理由:

- ReDoS リスクがある
- UA 文字列は `includes` で十分な粒度が得られる
- レビューコストと誤設定リスクが不必要に増える

> ⚠️ バックエンド `cli-output-filter.ts` の `BENIGN_DIAGNOSTIC_PATTERNS` は正規表現を使用していますが、本フィルタは別ライフサイクル・別用途のため統合しません。

---

## 4. isBenign() の動作仕様

```typescript
export function isBenign(message: string, ctx?: { ua?: string; env?: string }): boolean
```

### ctx の評価ルール

| 状態 | 振る舞い |
|------|---------|
| `ctx` 自体が未指定 | UA/env 制約を**スキップ** (後方互換) |
| `ctx.ua` が undefined (navigator 不在 / SSR) | UA 制約をスキップ |
| `ctx.env` が undefined | env 制約をスキップ |
| `entry.ua` が未指定 | 全 UA で有効 |
| `entry.env` が未指定または空配列 | 全環境で有効 |

### send() でのコンテキスト注入

```typescript
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
const env = process.env.NODE_ENV;
if (isBenign(payload.message, { ua, env })) return;
```

`navigator` が存在しない環境（SSR / jsdom）では `ua` が `undefined` となり、UA 制約は自動的にスキップされます。

---

## 5. 現在の BENIGN_ERROR_PATTERNS 一覧

| pattern | mode | ua | env | 抑制理由 |
|---------|------|-----|-----|---------|
| `ResizeObserver loop limit exceeded` | prefix | — | — | Chrome/Edge: ResizeObserver のコールバックが1アニメーションフレーム内に完了できない場合に発火。ブラウザが自動でリトライするため無害 |
| `ResizeObserver loop completed with undelivered notifications.` | prefix | — | — | Firefox/Safari 版の同種メッセージ。同様に無害なタイミング上の警告 |
| `Script error.` | prefix | — | — | クロスオリジン `<script>` エラー: ブラウザがセキュリティ上の理由で詳細を `"Script error."` に置換。情報がなく対処不能 |

---

## 6. 新規エントリを追加するための判定基準

`BENIGN_ERROR_PATTERNS` にエントリを追加できるのは、以下の **3 条件すべてを満たす場合のみ** です。

### 条件 1: Known — 出所が明確である

- 特定のブラウザ・フレームワーク・ライブラリの**公式ドキュメントや公開された Issue** で言及されているエラーであること
- 「なんとなく無害そう」はNG。根拠 URL またはソースコード該当箇所を PR に添付すること

### 条件 2: Harmless — アプリケーションへの影響がない

- ユーザーに見える機能破損・データ損失・不正な状態遷移が**発生しない**こと
- ブラウザが内部でリトライ・回避する仕組みが存在すること、または単に情報不足で対処不能であること

### 条件 3: Duplicate-noise — 重複して報告される

- 1 回のページ操作またはセッション内で**繰り返し発火**し、`/system/errors` や Sentry をノイズで埋める実績があること
- 1 回しか発火しないエラーは、もし本物の障害であったときに気づけなくなるため、フィルタしないこと

---

## 7. 新規エントリを追加する手順

1. **条件 1〜3 をすべて満たすか確認する** (上記セクション参照)

2. **`rapitas-frontend/src/config/benign-error-patterns.ts` の `BENIGN_ERROR_PATTERNS` 配列に追加する**

   ```typescript
   // 全 UA・全環境で抑制するパターン（最も一般的）
   {
     pattern: 'Your new prefix here',
     note: '[ブラウザ名]: [エラーの説明 — なぜ無害か1行で] 参照: <URL>',
   },

   // 特定ブラウザのみで抑制するパターン
   {
     pattern: 'WebGL: INVALID_OPERATION',
     ua: 'Firefox',
     note: 'Firefox 固有の WebGL 初期化警告。他ブラウザでは発生しない。',
   },

   // 特定環境のみで抑制するパターン
   {
     pattern: 'HMR connection lost',
     env: ['development'],
     note: '開発時の HMR 接続エラー。本番では発生しない。',
   },
   ```

3. **`note` フィールドを必ず記入する** — なぜ無害か、根拠を1行で残す

4. **このドキュメント (§5) を更新する** — エントリ追加と同じ PR で行うこと

5. **テストを確認する**
   - `GlobalErrorReporter.test.tsx` の `isBenign()` テストスイートは `it.each(BENIGN_ERROR_PATTERNS.map(e => e.pattern))` で全エントリの完全一致をカバーしているため、新規エントリは自動的にテスト対象になります
   - UA 限定・env 限定エントリを追加する場合は、専用のテストケースを追記してください

6. **PR レビューで確認するチェックリスト**
   - [ ] 条件 1〜3 の根拠が PR 説明に記載されている
   - [ ] `mode: 'prefix'` で問題ないか確認（`contains` は最終手段）
   - [ ] `ua` フィールドを設定する場合: `navigator.userAgent` に実際に含まれる文字列か確認
   - [ ] `env` フィールドを設定する場合: `process.env.NODE_ENV` の実際の値か確認
   - [ ] 大文字小文字がブラウザの実際の出力と一致している
   - [ ] このドキュメントの §5 が更新されている
   - [ ] テストがパスしている

---

## 8. アンチパターン

```typescript
// ❌ note を省略 — なぜ無害かが追跡不能になる
{ pattern: 'ResizeObserver loop limit exceeded' }

// ❌ 短すぎる prefix — 本物のエラーを握り潰す危険あり
{ pattern: 'Network error', note: '...' }  // "Network error: 503" も抑制してしまう

// ❌ 動的な部分を含めた prefix — バージョンが変わると一致しなくなる
{ pattern: 'ChunkLoadError: Loading chunk 123', note: '...' }  // 番号は毎回変わる

// ❌ 正規表現による ua マッチ — 不採用 (§3 参照)
{ pattern: 'WebGL error', ua: /Firefox\/\d+/, note: '...' }  // ua は文字列のみ

// ✅ 適切なエントリ
{
  pattern: 'ResizeObserver loop limit exceeded',
  note: 'Chrome/Edge: ブラウザが自動リトライ。データ損失なし。',
}
```

---

## 9. フィルタが適用される位置

```
browser error / unhandled rejection
        │
        ▼
   send(payload)
        │
   isBenign(message, ctx)?  ──── YES ──→ [抑制: fetch せず終了]
        │
        NO
        │
   shouldReport()?  ─── NO ──→ [重複除去: 10 秒以内の同一メッセージ]
        │
       YES
        │
   POST /system/errors
        │
        ├─→ リングバッファ (最近のエラーパネル)
        └─→ Sentry (設定時)
```

`isBenign()` は `shouldReport()` より**前**に評価されます。
無害エラーは重複チェックの対象にも入らないため、`recentMessages` バッファを不必要に消費しません。

---

## 10. 将来の拡張 (スコープ外)

- **DB + 管理画面**: `BenignErrorPattern` をデータベースに永続化し、設定ページ UI から動的追加・削除できるようにする。現時点では Prisma スキーマ変更（サーバー再起動必須）コストが高いためスコープ外。実装する場合は `prisma/schema/system.prisma` に `BenignErrorPattern` テーブルを追加し、`routes/system/error-filter-config.ts` で CRUD エンドポイントを設ける。
- **バックエンドとの統合**: `cli-output-filter.ts` の `BENIGN_DIAGNOSTIC_PATTERNS`（正規表現・バックエンド専用）と設計を統一することも検討できるが、ライフサイクルが異なるため慎重に判断する。

---

## 11. 関連ドキュメント

- [ADR-0004: TypeScript strictness ratchet](../adr/0004-typescript-strictness-ratchet.md)
- [COMMENT_POLICY.md](../../.claude/COMMENT_POLICY.md) — コメント記述ガイドライン
- バックエンド側の類似フィルタ: `rapitas-backend/services/agents/cli-output-filter.ts` (`BENIGN_DIAGNOSTIC_PATTERNS`)
