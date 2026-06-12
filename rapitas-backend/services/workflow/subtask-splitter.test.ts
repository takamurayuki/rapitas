/**
 * subtask-splitter.test
 *
 * Locks down split GRANULARITY: a normal structured plan (whose ## sections are
 * standard meta sections like 実装チェックリスト / 完了条件) must NOT split into
 * bogus subtasks, while a plan with genuine multi-component feature sections
 * still splits.
 */
import { describe, it, expect } from 'bun:test';
import { analyzePlanForSplitting } from './subtask-splitter';

// A typical single-unit plan: every ## heading is a standard meta section.
const META_ONLY_PLAN = `# Plan

## タスク概要
小さな修正。

## 実装チェックリスト
- [ ] a.ts を直す
- [ ] b.ts を直す

## リスク評価
低い。

## 完了条件 (DoD)
- [ ] テストが通る
`;

// A genuinely multi-component plan: three real feature sections.
const MULTI_FEATURE_PLAN = `# Plan

## タスク概要
大きめ。

## バックエンド: 認証API
- [ ] services/auth/login.ts を実装
- [ ] services/auth/token.ts を実装

## フロントエンド: ログイン画面
- [ ] app/login/page.tsx を実装
- [ ] components/LoginForm.tsx を実装

## データベース: マイグレーション
- [ ] prisma/schema/auth.prisma を追加

## 完了条件
- [ ] 全テストが通る
`;

describe('analyzePlanForSplitting — granularity', () => {
  it('does NOT split a normal plan made only of meta sections', () => {
    const result = analyzePlanForSplitting(META_ONLY_PLAN);
    expect(result.metrics.independentGroups).toBe(0);
    expect(result.shouldSplit).toBe(false);
    expect(result.subtasks).toHaveLength(0);
  });

  it('never emits a subtask titled after a meta section', () => {
    const result = analyzePlanForSplitting(MULTI_FEATURE_PLAN);
    const titles = result.subtasks.map((s) => s.title);
    expect(titles.some((t) => /チェックリスト|完了条件|リスク|概要/.test(t))).toBe(false);
  });

  it('splits a plan with genuine multi-component feature sections', () => {
    const result = analyzePlanForSplitting(MULTI_FEATURE_PLAN);
    expect(result.metrics.independentGroups).toBeGreaterThanOrEqual(3);
    expect(result.shouldSplit).toBe(true);
    expect(result.subtasks.length).toBeGreaterThanOrEqual(3);
  });
});
