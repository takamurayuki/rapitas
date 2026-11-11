import 'package:flutter/material.dart';

/// タスク詳細の「完了条件」と「いまの段階」の節（ラピ伴走化 第1段階）。
///
/// どちらもタスク DB の値（acceptanceCriteria / workflowStatus / haltReason）をそのまま見せる。
/// 完了かどうかを決めるのは完了ゲートと陪審なので、ここでは判定の材料と現在地だけを出す。

/// ワークフローの段階の表示名と、いま何が起きているかの一文
class WorkflowStageInfo {
  final String label;
  final String detail;

  /// 主な流れ（下書き→調査→計画→承認→実装→検証→完了）の何番目か。回答待ちは null
  final int? step;

  const WorkflowStageInfo(this.label, this.detail, this.step);
}

/// 主な流れの段数（下書き〜完了）
const int workflowStageCount = 7;

const Map<String, WorkflowStageInfo> _stages = {
  'draft': WorkflowStageInfo('下書き', 'まだ調査を始めていません。', 0),
  'research_done': WorkflowStageInfo('調査済み', '調査が終わり、計画づくりを待っています。', 1),
  'plan_created': WorkflowStageInfo('計画の承認待ち', '計画ができました。承認すると実装に進みます。', 2),
  'plan_approved': WorkflowStageInfo('計画承認済み', '承認済みです。実装の開始を待っています。', 3),
  'in_progress': WorkflowStageInfo('実装中', 'エージェントが実装しています。', 4),
  'awaiting_question': WorkflowStageInfo('回答待ち', 'エージェントからの質問に答えると再開します。', null),
  'verify_done': WorkflowStageInfo('完了の確認中', '検証が終わり、完了ゲートと陪審が確認しています。', 5),
  'completed': WorkflowStageInfo('完了', '完了ゲートと陪審の確認を通りました。', 6),
};

/// [workflowStatus] の表示。null はワークフローに乗っていないタスク、未知のコードはそのまま見せる
WorkflowStageInfo workflowStageInfo(String? workflowStatus) {
  if (workflowStatus == null) {
    return const WorkflowStageInfo('未開始', 'エージェントの作業はまだ始まっていません。', null);
  }
  return _stages[workflowStatus] ?? WorkflowStageInfo(workflowStatus, '', null);
}

const Map<String, String> _haltReasons = {
  'budget_time_exceeded': '作業時間の上限に達したため、自動で止まっています。',
  'budget_cost_exceeded': '費用の上限に達したため、自動で止まっています。',
  'budget_attempts_exceeded': 'やり直しの回数が上限に達したため、自動で止まっています。',
  'repeat_cause_detected': '同じ原因の失敗が続いたため、自動で止まっています。',
  'no_progress': '進み具合が見られないため、自動で止まっています。',
  'awaiting_review_decision': 'レビューの結論が出ず、あなたの判断を待っています。',
};

/// 止まっている理由の平易な文。未知のコードは理由コードを添えて返す
String haltReasonText(String haltReason) =>
    _haltReasons[haltReason] ?? '自動で止まっています（理由: $haltReason）。';

/// 「完了条件」の節。陪審はこの条件で完了を判定する
class TaskAcceptanceCriteriaSection extends StatelessWidget {
  final List<String> criteria;

  const TaskAcceptanceCriteriaSection({super.key, required this.criteria});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('完了条件', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        if (criteria.isEmpty)
          Text('完了条件はまだ登録されていません。', style: muted)
        else ...[
          for (var i = 0; i < criteria.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 22,
                    child: Text('${i + 1}.',
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  ),
                  Expanded(child: Text(criteria[i], style: theme.textTheme.bodyMedium)),
                ],
              ),
            ),
          const SizedBox(height: 2),
          Text('完了かどうかは、この条件をもとに完了ゲートと陪審が判定します。', style: muted),
        ],
      ],
    );
  }
}

/// 「いまの段階」の節。ワークフローの現在地と、止まっていればその理由
class TaskStageSection extends StatelessWidget {
  final String? workflowStatus;
  final String? haltReason;

  const TaskStageSection({super.key, this.workflowStatus, this.haltReason});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final info = workflowStageInfo(workflowStatus);
    final step = info.step;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('いまの段階', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        // Default margin, so the card lines up with the detail card below it.
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(info.label,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    if (step != null)
                      Text('${step + 1} / $workflowStageCount',
                          style: theme.textTheme.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
                ),
                if (step != null) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      for (var i = 0; i < workflowStageCount; i++) ...[
                        if (i > 0) const SizedBox(width: 4),
                        Expanded(
                          child: Container(
                            height: 4,
                            decoration: BoxDecoration(
                              color: i <= step ? scheme.primary : scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
                if (info.detail.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(info.detail, style: theme.textTheme.bodyMedium),
                ],
                if (haltReason != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: scheme.errorContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.pause_circle_outline, size: 18, color: scheme.onErrorContainer),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(haltReasonText(haltReason!),
                              style: theme.textTheme.bodyMedium
                                  ?.copyWith(color: scheme.onErrorContainer)),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}
