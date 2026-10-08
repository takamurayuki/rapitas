/**
 * fallback-package
 *
 * The deterministic 4-document scaffold returned when AI generation fails, so
 * the wizard still yields something and — critically — says plainly that it is
 * a scaffold. NOT a specification generator: every slot is filled from the
 * one-paragraph proposal.
 */

import type { ClaudeMdRequest, GenerateResult } from './document-package-prompt';

// NOTE: This package carries no more information than the original idea. On
// 2026-10-08 a ContextFlow run shipped it as a "96点" result after the AI call
// timed out, and the 34-line requirements.md it produced blocked implementation
// for a long time because nothing said it was a fallback. The banner and the
// honest score exist so that cannot happen silently again: the file that lands
// in the repo states what it is.
const BANNER = `> ⚠️ **自動生成に失敗したため、テンプレートの雛形を出力しています。**
> この内容はアイデア1段落を各項目に差し込んだだけで、実装に着手できる情報量はありません。
> 「実装時に具体化する」「実装時に確定する」と書かれた箇所は未定義です。
> 生成をやり直してください（失敗理由はサーバーログの \`AI generation failed\` を参照）。

`;

/** Maps the wizard's scale key to the user-facing audience label. */
function scaleLabelOf(scale: string): string {
  if (scale === 'solo') return '個人利用者';
  if (scale === 'small') return '小規模チーム（〜100人）';
  if (scale === 'mid') return '中規模組織（〜1万人）';
  return '大規模組織（1万人以上）';
}

/**
 * Build the fallback package.
 *
 * @param proposal - The chosen app proposal. / 選択されたアプリ案
 * @param plat - Target platform label. / 対象プラットフォーム
 * @param scale - Wizard scale key. / 規模の選択値
 * @returns A scaffold package marked as such in its own text. / 雛形であることを明記した文書一式
 */
export function buildFallbackResponse(
  proposal: ClaudeMdRequest['proposal'],
  plat: string,
  scale: string,
): GenerateResult {
  const scaleLabel = scaleLabelOf(scale);
  const stack = proposal.tech_hint?.length
    ? proposal.tech_hint
    : ['Next.js 14', 'Supabase', 'TypeScript'];

  return {
    tech_rationale: `【テンプレート出力・AI生成は失敗しました】${stack[0]}と${stack[1] || 'Supabase'}を中心とした技術スタックを選定しました。${proposal.concept}というコンセプトに最適なフレームワークと、開発効率を重視した構成です。${stack[2] || 'TypeScript'}による型安全性と保守性を確保します。`,
    // Not a judgement of the idea — a statement that this output is a scaffold.
    score: 20,
    // NOTE: Deliberately empty, for the same reason the ADR records nothing: a
    // package.json for a stack nobody chose would produce a project that LOOKS
    // set up, and the next agent would build on invented dependencies.
    scaffold: [],
    requirements: `${BANNER}# 概要

**アプリ名**: ${proposal.name}
**解決する課題**: ${proposal.concept}
**ターゲットユーザー**: ${scaleLabel}
**提供価値**: ${proposal.unique}
**プラットフォーム**: ${plat}

# ユーザーストーリー

- ユーザーとして、${proposal.concept}を達成したい。なぜなら${proposal.unique}だから。
- 新規ユーザーとして、迷わず初期設定を終えたい。なぜなら離脱したくないから。

# 機能要件

- **[F-01] コア機能**: ${proposal.unique}（入力 → 処理 → 出力を実装時に具体化する）
- **[F-02] 認証**: サインアップ / ログイン / ログアウト
- **[F-03] データ管理**: 主要エンティティのCRUD

# 画面一覧

- ランディング / ダッシュボード / 詳細 / 設定

# 非機能要件

- 性能: 主要操作のレスポンス 300ms 以内（目標）
- セキュリティ: 入力値サニタイズ・秘匿情報は環境変数

# 受け入れ基準

- [ ] [F-01] Given 前提 / When 操作 / Then 期待結果

# スコープ外

- 実装フェーズで合意するまで未確定の機能は対象外。`,
    design: `${BANNER}# アーキテクチャ概要

クライアント（${plat}） → アプリケーション層 → データストア の3層構成。

# 技術スタック

${stack.map((t) => `- **${t}**`).join('\n')}

# ディレクトリ構成

\`\`\`
src/
├── app/          # 画面・ルーティング
├── components/   # UIコンポーネント
├── lib/          # ドメインロジック
└── types/        # 型定義
\`\`\`

# データモデル

主要エンティティを実装時に確定する（例: User, ${proposal.name.replace(/\s+/g, '')}Item）。

# API設計

- \`GET /api/items\` 一覧取得 / \`POST /api/items\` 作成（[F-03] と対応）

# 環境変数

\`\`\`env
NEXT_PUBLIC_APP_NAME=${proposal.name}
\`\`\``,
    // NOTE: Deliberately NOT a plausible-looking ADR. An invented rationale for
    // a stack nobody actually chose is worse than none: it would be read as a
    // real decision and inherited by every later change. So this states that no
    // decision was recorded and lists what has to be decided.
    adr: `${BANNER}# 技術選定記録 (ADR)

## 記録なし

**AI生成が失敗したため、技術選定の意思決定は行われていません。**
上の「技術スタック」はアイデア入力時の技術ヒント（${stack.join(' / ')}）を
そのまま並べたもので、代替案の比較も却下理由の検討も行われていません。

このままでは「なぜこの技術なのか」を誰も説明できません。生成をやり直すか、
以下を人間が決めてADR-0001以降として追記してください。

## 決めなければならないこと

- [ ] **ADR-0001 中核機能を担う技術**: ${proposal.unique} を実現する手段（文脈 / 代替案2件以上 / 却下理由 / トレードオフ / 撤回条件）
- [ ] **ADR-0002 データストア**: 必要なクエリ特性（全文検索・ベクトル検索・集計・地理情報等）を先に確定する
- [ ] **ADR-0003 認証・認可**: 方式とテナント分離の単位
- [ ] **ADR-0004 同期/非同期**: ジョブキューとワーカーの要否
- [ ] **ADR-0005 配信形態**: ${plat} に対して Web / PWA / ネイティブ のどれか、およびその理由
- [ ] **ADR-0006 ホスティング**: インフラ構成とリージョン

### 各ADRに書く項目

| 項目 | 内容 |
| --- | --- |
| ステータス | 採用 / 条件付き採用 |
| 文脈 | この決定を左右した機能要件[F-xx]・非機能要件 |
| 決定 | 技術名 + バージョン（design.md と一致させる） |
| 検討した代替案 | 実在する製品・手法を2つ以上 |
| 却下理由 | このアプリのどの要件を満たせないか |
| トレードオフ | 失うもの・引き受けるリスク（「なし」は禁止） |
| 撤回条件 | 再検討の引き金となる観測値 |`,
    claude_md: `# Project Overview

**アプリ名**: ${proposal.name}
**コンセプト**: ${proposal.concept}
**関連ドキュメント**: \`docs/requirements.md\`（要件定義） / \`docs/design.md\`（設計） / \`docs/adr/0001-architecture-decisions.md\`（技術選定記録）

# Development Commands

\`\`\`bash
npm run dev    # 開発サーバー起動
npm run build  # ビルド
npm test       # テスト実行
\`\`\`

# Coding Rules

- **コンポーネント**: PascalCase / **hooks**: useプレフィックス + camelCase
- **関数・変数**: camelCase / **定数**: UPPER_SNAKE_CASE / **ファイル名**: kebab-case
- 禁止: any型 / ハードコードされたAPIキー / console.logの本番残留

# Testing Policy

- ユニット: ユーティリティ・hooks（80%カバレッジ）
- 結合: 主要コンポーネント / E2E: 重要ユーザーフロー

# Git Policy

- feat / fix / docs / refactor / test / chore（imperative mood・英語）

# Claude Behavior

## 実装前チェックリスト
- [ ] 要件が明確か？不明点は必ず質問する
- [ ] DBスキーマ変更時は設計提案を行う
- [ ] セキュリティ影響を評価する
- [ ] ADRに記録された技術を置き換えていないか（置き換える場合は新ADRを追記して承認を得る）

## 絶対禁止事項
- 本番データベースの直接操作 / APIキーのハードコード
- 承認なしのスキーマ変更 / テストなしの重要機能実装

---
AIプロバイダーのAPIキーを設定すると、より詳細な4点セットが生成されます。`,
  };
}
