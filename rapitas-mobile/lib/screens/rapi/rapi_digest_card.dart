import 'package:flutter/material.dart';
import '../../models/companion_digest.dart';
import '../../utils/plain_reasons.dart';
import '../../widgets/task_companion_sections.dart' show workflowStageInfo;

// 伴走の要約カード（ラピ伴走化 第2段階-1、設計 段D）。ラピタブを開いたとき、会話の先頭に出す。
//
// タスクごとに「何が起きたか」「あなたが決めること」「その画面」を出す。判断のボタンはここには
// 置かない（ラピは判断を代わりに送らない。設計 2章）。「〇〇の画面を開く」で判断画面へ移るだけ。
// 見た目は伴走の確認カード（rapi_companion_card.dart）にそろえる。

const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
const _bodyColor = Color(0xFF18181B);
const _mutedBody = Color(0xFF3F3F46);
const _decisionBg = Color(0xFFFFFBEB);
const _decisionBorder = Color(0xFFFDE68A);
const _decisionText = Color(0xFF92400E);

/// 1件の「何が起きたか」を、モデルを使わずに数えた値から文にする
List<String> digestHappenings(DigestItem item) {
  final lines = <String>[];
  final decisionKind = item.decision?.kind;
  if (item.recent.isNotEmpty) {
    final e = item.recent.first;
    // 止まった・保留になったことは、下の理由の文が言うので重ねない
    final saidBelow = (e.kind == 'halted' && decisionKind == 'release_halt') ||
        (e.kind == 'review_held' && decisionKind == 'review_hold');
    if (!saidBelow) {
      lines.add(digestEventText(e.kind, stageLabel: workflowStageInfo(e.toStatus).label));
    }
  }
  final counts = [
    if (item.repairs > 0) '差し戻し${item.repairs}回',
    if (item.questions > 0) '質問${item.questions}件',
    if (item.halts > 0) '停止${item.halts}回',
    if (item.holds > 0) '保留${item.holds}回',
    if (item.replans > 0) '計画の立て直し${item.replans}回',
  ];
  if (item.transitions > 1 || counts.isNotEmpty) {
    lines.add('前回から${item.transitions}件の動き${counts.isEmpty ? '' : '（${counts.join('・')}）'}');
  }
  final decision = item.decision;
  if (decision?.kind == 'release_halt' && decision?.haltReason != null) {
    lines.add(haltReasonText(decision!.haltReason!));
  } else if (decision?.kind == 'review_hold') {
    lines.add(decision?.holdReason != null
        ? holdReasonText(decision!.holdReason!)
        : haltReasonText('awaiting_review_decision'));
  }
  if (item.repairTotal > 0 && item.repairTopCause != null) {
    lines.add('差し戻しは今の区切りで${item.repairTotal}回。多い原因：${repairCauseText(item.repairTopCause!)}');
  }
  if (lines.isEmpty) lines.add('いまの段階：${workflowStageInfo(item.workflowStatus).label}');
  return lines;
}

class RapiDigestCardView extends StatelessWidget {
  final CompanionDigest digest;

  /// 判断画面を開く（decision.link）
  final void Function(String link) onOpenDecision;

  /// タスクの詳細を開く
  final void Function(String taskId) onOpenTask;

  /// 各タスクの行に付けるキー。画面がその行が見えているかを測るのに使う（既読は見えた行の分だけ）
  final GlobalKey Function(String taskId)? itemKeyOf;

  const RapiDigestCardView({
    super.key,
    required this.digest,
    required this.onOpenDecision,
    required this.onOpenTask,
    this.itemKeyOf,
  });

  @override
  Widget build(BuildContext context) {
    final waiting = digest.decisionCount;
    final heading = waiting > 0 ? 'あなたの判断を待っているタスクが$waiting件あります' : '伴走中のタスクに動きがありました';
    return Container(
      decoration: BoxDecoration(
        color: _violetBg,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('前回からの様子', style: _labelStyle.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(heading,
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(color: _violetButton, fontWeight: FontWeight.w600)),
          for (final item in digest.items) ...[
            const SizedBox(height: 10),
            KeyedSubtree(
              key: itemKeyOf?.call(item.taskId),
              child: _DigestItemView(
                key: ValueKey('rapi-digest-item-${item.taskId}'),
                item: item,
                onOpenDecision: onOpenDecision,
                onOpenTask: onOpenTask,
              ),
            ),
          ],
          const SizedBox(height: 6),
        ],
      ),
    );
  }
}

class _DigestItemView extends StatelessWidget {
  final DigestItem item;
  final void Function(String link) onOpenDecision;
  final void Function(String taskId) onOpenTask;

  const _DigestItemView({
    super.key,
    required this.item,
    required this.onOpenDecision,
    required this.onOpenTask,
  });

  @override
  Widget build(BuildContext context) {
    final decision = item.decision;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(10),
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => onOpenTask(item.taskId),
            child: Text(item.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 15, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          ),
          const SizedBox(height: 6),
          const Text('何が起きたか', style: _labelStyle),
          for (final line in digestHappenings(item))
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(line, style: const TextStyle(fontSize: 13, color: _mutedBody, height: 1.5)),
            ),
          if (decision != null) ...[
            const SizedBox(height: 8),
            Container(
              key: ValueKey('rapi-digest-decision-${item.taskId}'),
              width: double.infinity,
              decoration: BoxDecoration(
                color: _decisionBg,
                border: Border.all(color: _decisionBorder),
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('あなたが決めること：${decisionCopy(decision.kind).title}',
                      style: const TextStyle(
                          fontSize: 12, color: _decisionText, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(decisionCopy(decision.kind).ask,
                      style: const TextStyle(fontSize: 13, color: _bodyColor, height: 1.5)),
                ],
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                key: ValueKey('rapi-digest-open-${item.taskId}'),
                style: TextButton.styleFrom(foregroundColor: _violetButton),
                onPressed: () => onOpenDecision(decision.link),
                iconAlignment: IconAlignment.end,
                icon: const Icon(Icons.chevron_right, size: 18),
                label: Text('${decisionCopy(decision.kind).title}の画面を開く'),
              ),
            ),
          ] else
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                style: TextButton.styleFrom(foregroundColor: _violetButton),
                onPressed: () => onOpenTask(item.taskId),
                child: const Text('タスクを開く'),
              ),
            ),
        ],
      ),
    );
  }
}
