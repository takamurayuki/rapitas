#!/usr/bin/env bun
/**
 * learning-loop-status.ts
 *
 * One-shot health report for every self-improvement loop, printed as a
 * checklist with expected directions — run it after a restart (and again days
 * later) to see whether each improvement is actually moving the numbers.
 * Reads ONLY the live HTTP API (port 3001), so it works regardless of the
 * generated Prisma client's provider (no drift issues) and never touches the
 * DB directly.
 *
 * Usage: bun scripts/learning-loop-status.ts
 */

const BASE = process.env.RAPITAS_API_BASE ?? 'http://127.0.0.1:3001';

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function line(label: string, value: string, target: string): void {
  console.log(`  ${label.padEnd(34)} ${value.padEnd(24)} 目標: ${target}`);
}

async function main(): Promise<void> {
  console.log(`\n=== rapitas 自己改善ループ健全性レポート (${BASE}) ===\n`);

  // 1. KB 検証収束(矛盾ドレイン+pending遡及検証)
  const kb = await get<{
    totalEntries: number;
    byValidation: Record<string, number>;
    unresolvedContradictions?: number;
    effectiveness?: {
      sampledTasks: number;
      successRate: number;
      declarationRate: number;
      usageRate: number;
      wrongFlagged: number;
    };
  }>('/knowledge/stats');
  console.log('■ 知識ベースの検証収束');
  if (kb) {
    const v = kb.byValidation;
    const total = kb.totalEntries || 1;
    line(
      '未解決矛盾',
      String(kb.unresolvedContradictions ?? '—'),
      '0近傍で安定(増えたら検出側の異常)',
    );
    line(
      'conflict',
      `${v.conflict ?? 0} (${(((v.conflict ?? 0) / total) * 100).toFixed(1)}%)`,
      '1桁台を維持',
    );
    line(
      'pending',
      `${v.pending ?? 0} (${(((v.pending ?? 0) / total) * 100).toFixed(1)}%)`,
      '毎晩~100件ずつ減少',
    );
    line(
      'validated',
      `${v.validated ?? 0} (${(((v.validated ?? 0) / total) * 100).toFixed(1)}%)`,
      '上昇し続ける',
    );
  } else {
    console.log('  取得失敗(サーバー未起動?)');
  }

  // 2. 注入知識の効果(因果計測)
  console.log('\n■ 注入知識→成果の因果計測 (直近30日)');
  if (kb?.effectiveness) {
    const e = kb.effectiveness;
    line('サンプルタスク数', String(e.sampledTasks), 'タスク完了ごとに増える(0のままなら配線異常)');
    line('成功率(知識注入あり)', pct(e.successRate), '長期的に上昇');
    line('使用申告率', pct(e.declarationRate), '上昇(research/plan/verify全解析化の効果)');
    line('注入知識の実使用率', pct(e.usageRate), '上昇(低いままなら注入の質を再考)');
    line('誤り申告された知識', String(e.wrongFlagged), '発生すれば自動でreject(健全)');
  } else {
    console.log('  effectiveness未取得 — 再起動後最初のタスク完了で出現します');
  }

  // 3. 意思決定ジャーナル(人間vs自動の較正)
  const dec = await get<{
    byDecider: Record<
      string,
      { total: number; correct: number; wrong: number; pending: number; precision: number | null }
    >;
  }>('/memory/decisions/stats');
  console.log('\n■ plan承認ゲートの較正(人間 vs 自動)');
  if (dec && Object.keys(dec.byDecider).length > 0) {
    for (const [who, s] of Object.entries(dec.byDecider)) {
      line(
        `${who} の判断`,
        `${s.total}件 / 的中率 ${pct(s.precision)}`,
        '較正済み20件超えたら比較に意味が出る',
      );
    }
  } else {
    console.log('  記録なし — plan承認/自動承認が発生すると蓄積されます(要再起動後)');
  }

  // 4. 知識グラフ(ノード多様化+エッジ=落とし穴警告の弾)
  const graph = await get<{
    nodeCount?: number;
    edgeCount?: number;
    byNodeType?: Record<string, number>;
  }>('/knowledge-graph/stats');
  const overview = await get<{
    knowledgeDistribution: Array<{ category: string; count: number; percentage: number }>;
  }>('/learning/memory-overview');
  console.log('\n■ 知識グラフ(実装者への落とし穴警告の源泉)');
  if (overview) {
    const dist = overview.knowledgeDistribution.map((d) => `${d.category}:${d.count}`).join(' / ');
    line('ノード分布', dist || '(空)', '5タイプが並行して成長');
  }
  if (graph) {
    line('エッジ数', String(graph.edgeCount ?? '—'), 'タスク終端ごとに増加(0のままなら配線異常)');
  }

  // 5. プロンプト進化(検出→提案→承認→適用)
  const proposals = await get<{ proposals: Array<{ id: number; basePromptKey: string | null }> }>(
    '/learning/prompt-evolution/proposals',
  );
  console.log('\n■ プロンプト進化(人間承認ゲート)');
  if (proposals) {
    line(
      '承認待ち提案',
      String(proposals.proposals.length),
      '月曜7AM後に出現 → /system-prompts で承認/却下',
    );
  } else {
    console.log('  取得失敗');
  }

  // 6. 信頼度トレンド(定数80%からの脱却)
  const timeline = await get<{ timeline: Array<{ date: string; avgConfidence: number }> }>(
    '/learning/growth-timeline?period=7d',
  );
  console.log('\n■ 信頼度トレンド(直近7日)');
  if (timeline) {
    const vals = timeline.timeline.map((t) => (t.avgConfidence > 0 ? pct(t.avgConfidence) : '—'));
    line('日次(7日窓)', vals.join(' '), '日々変動する(80.0%固定に戻ったら異常)');
  }

  console.log('\n--- 観測ログの目印(バックエンドログを grep) ---');
  console.log('  [pitfall-context]      … 落とし穴警告が実装者に注入された');
  console.log('  [prompt-evolution]     … 承認済み追記がロールに注入された / 提案が生成された');
  console.log('  [decision-journal]     … plan判断の記録・較正が行われた');
  console.log('  [kb-reinforce]         … 注入知識への報酬/減衰が適用された');
  console.log('  [contradiction-sweep]  … 夜間ドレイン/仮説昇格が実行された');
  console.log('  workflow_mode_rule_applied … 学習ルールがモードを調整した(ActivityLog)');
  console.log('');
}

main().catch((err) => {
  console.error('failed:', err);
  process.exitCode = 1;
});
