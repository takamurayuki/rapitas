<!--
PR タイトルは "[#<issue>] <説明>" の形式にしてください (例: [#1513] ロードマップ作成から節目を自動で作る)。
コミットメッセージは Conventional Commits (feat(scope): ... など) に沿ってください。
-->

## 概要 / Summary

<!-- 何を、なぜ変更したかを 1-3 行で -->

## 関連 Issue

<!-- この PR で Issue が完了するなら Closes、一部の対応なら Refs -->
Closes #

## 変更内容 / Changes

- [ ]
- [ ]

## スクリーンショット / 動作確認

<!-- UI 変更がある場合は before / after を貼ってください -->

## テスト手順 / Test plan

- [ ] `bun test` (backend) が通る
- [ ] `pnpm test` (frontend) が通る
- [ ] `pnpm tsc --noEmit` (frontend) が通る
- [ ] 影響範囲の手動確認 (記載: )

## チェックリスト / Checklist

- [ ] CLAUDE.md のワークフロー (research → plan → implement → verify) に沿って作業した
- [ ] 追加・変更した public 関数に JSDoc/rustdoc を書いた
- [ ] 1 ファイル 500 行以内 / 1 ディレクトリ 10 ファイル以内 (20 を超えたら即分割) のルールを満たす
- [ ] `any` 型を使っていない (やむを得ない場合は `// HACK(agent):` 付き)
- [ ] secret / 認証情報を含めていない
- [ ] base ブランチが正しい (通常 `develop`)
