import 'package:flutter/material.dart';
import '../../models/rapi.dart';
import '../../providers/rapi_chat_provider.dart';
import '../../widgets/rapi_criteria_list.dart';

// 計画（roadmap）カード（デスクトップ TaskRoadmap.tsx のモバイル版）。
//
// 段階ごとに出すもの：
//   質問あり（questions / refining）：目標・置き場所・質問（選択肢チップ、推奨が初期選択）・
//     手順の案（題名だけ）、「この内容で作り直す」「やめる」
//   最終確認（ready / committing）：目標・テーマ・プロジェクト・期限・決めたこと・手順の一覧
//     （説明まで。作られるタスクそのもの）、「この計画で作成する（N件）」「やめる」
//   作成後（committed）：作った件数・テーマ／プロジェクト・途中で止まった位置、「タスク一覧を見る」
//   結果不明（commitUnknown）：作り直させず、タスク一覧で確かめてもらう
// 見た目は変更カード（rapi_screen.dart の _ChangeCard）にそろえる。
// NOTE: 候補の調査（/assistant/research）と締めのノートはデスクトップだけ（provider の NOTE 参照）。

const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
const _mutedStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.45);
const _bodyColor = Color(0xFF18181B);
const _doneGreen = Color(0xFF047857);
const _warnAmber = Color(0xFFB45309);

class RapiRoadmapCardView extends StatelessWidget {
  final RapiRoadmapCard card;
  final void Function(int index, String answer) onAnswer;
  final VoidCallback onRefine;
  final VoidCallback onCommit;
  final VoidCallback onCancel;
  final VoidCallback onOpenTasks;

  const RapiRoadmapCardView({
    super.key,
    required this.card,
    required this.onAnswer,
    required this.onRefine,
    required this.onCommit,
    required this.onCancel,
    required this.onOpenTasks,
  });

  @override
  Widget build(BuildContext context) {
    final phase = card.phase;
    final draft = card.draft;
    final asking = phase == RapiRoadmapPhase.questions || phase == RapiRoadmapPhase.refining;
    final confirming = phase == RapiRoadmapPhase.ready || phase == RapiRoadmapPhase.committing;
    final result = card.result;
    final partial = result?.stoppedPartway ?? false;

    final String heading = switch (phase) {
      RapiRoadmapPhase.questions || RapiRoadmapPhase.refining => '計画の下書き',
      RapiRoadmapPhase.ready || RapiRoadmapPhase.committing => 'この計画で作成しますか',
      RapiRoadmapPhase.committed => partial ? '計画を途中まで作成しました' : '計画を作成しました',
      RapiRoadmapPhase.commitUnknown => '作成できたか確かめられませんでした',
    };
    final warn = phase == RapiRoadmapPhase.commitUnknown || partial;
    final headingColor = warn ? _warnAmber : _violetButton;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      decoration: BoxDecoration(
        color: _violetBg,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Icon(
                  switch (phase) {
                    RapiRoadmapPhase.committed =>
                      partial ? Icons.warning_amber_rounded : Icons.check_circle,
                    RapiRoadmapPhase.commitUnknown => Icons.help_outline,
                    _ => Icons.flag_outlined,
                  },
                  size: 16,
                  color: headingColor,
                ),
              ),
              Expanded(
                child: Text(heading,
                    style: textTheme.labelLarge
                        ?.copyWith(color: headingColor, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text('目標', style: _labelStyle),
          const SizedBox(height: 2),
          Text(draft.goal,
              style: const TextStyle(
                  fontSize: 15, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          const SizedBox(height: 4),
          // 作成後は結果の行（作ったテーマ／プロジェクト）で言い直すので、案の行は出さない
          if (phase != RapiRoadmapPhase.committed) ...[
            _placementRow('テーマ', draft.themeChoice),
            _placementRow('プロジェクト', draft.projectChoice),
            if (draft.deadline != null) _row('期限', _date(draft.deadline!)),
          ],
          if (asking) ...[
            const SizedBox(height: 12),
            const Text('計画を決める前に確認させてください', style: _labelStyle),
            for (var i = 0; i < card.asked.length; i++)
              _QuestionBlock(
                index: i,
                question: card.asked[i],
                selected: i < card.answers.length ? card.answers[i] : null,
                enabled: phase == RapiRoadmapPhase.questions,
                onSelect: (a) => onAnswer(i, a),
              ),
          ],
          if (!asking && card.asked.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text('決めたこと', style: _labelStyle),
            for (final d in card.decisions)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(text: '${d.question}  '),
                    TextSpan(
                        text: d.answer.trim().isEmpty ? '—' : d.answer,
                        style: const TextStyle(fontWeight: FontWeight.w600, color: _bodyColor)),
                  ]),
                  style: _mutedStyle,
                ),
              ),
          ],
          if (phase != RapiRoadmapPhase.committed && phase != RapiRoadmapPhase.commitUnknown) ...[
            const SizedBox(height: 12),
            Text(
                asking
                    ? '手順の案（答えに合わせて作り直します）'
                    : '作成するタスク（${draft.steps.length}件）',
                style: _labelStyle),
            if (draft.steps.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('手順がありません。目標を言い換えて、もう一度送ってください。', style: _mutedStyle),
              ),
            for (var i = 0; i < draft.steps.length; i++)
              _StepRow(number: i + 1, step: draft.steps[i], withDescription: confirming),
          ],
          if (phase == RapiRoadmapPhase.committed && result != null) ..._resultLines(result),
          if (phase == RapiRoadmapPhase.commitUnknown)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                '通信の失敗や読めない応答のため、作成できたか確かめられませんでした。作成済みの場合もあるため、'
                'ここからは作成し直せません。タスク一覧で確かめてください。',
                style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
              ),
            ),
          if (card.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(card.error!,
                  style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
            ),
          const SizedBox(height: 12),
          if (asking || confirming)
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    key: ValueKey(asking ? 'rapi-roadmap-refine' : 'rapi-roadmap-commit'),
                    style: FilledButton.styleFrom(
                      backgroundColor: _violetButton,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
                      disabledForegroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: asking
                        ? (phase == RapiRoadmapPhase.questions ? onRefine : null)
                        : (card.canCommit ? onCommit : null),
                    child: Text(switch (phase) {
                      RapiRoadmapPhase.refining => '作り直しています…',
                      RapiRoadmapPhase.committing => '作成しています…',
                      RapiRoadmapPhase.questions => 'この内容で作り直す',
                      _ => 'この計画で作成する（${draft.steps.length}件）',
                    }),
                  ),
                ),
                const SizedBox(width: 8),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
                  onPressed: phase == RapiRoadmapPhase.questions || phase == RapiRoadmapPhase.ready
                      ? onCancel
                      : null,
                  child: const Text('やめる'),
                ),
              ],
            )
          else
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: const ValueKey('rapi-roadmap-open-tasks'),
                style: TextButton.styleFrom(foregroundColor: _violetButton),
                onPressed: onOpenTasks,
                child: const Text('タスク一覧を見る'),
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _resultLines(RoadmapCommitResult result) {
    final draft = card.draft;
    final made = result.taskIds.length;
    final failedAfter = result.failedAfter;
    String where(String label, RoadmapPlacement p, int? id) {
      if (id == null || p.isNone) return '$label：なし';
      final name = p.name ?? '$label#$id';
      return p.isNew ? '$label：「$name」を新しく作りました' : '$label：「$name」';
    }

    return [
      const SizedBox(height: 10),
      Text('タスクを$made件作成しました。',
          style: const TextStyle(
              fontSize: 14, color: _doneGreen, fontWeight: FontWeight.w600, height: 1.4)),
      const SizedBox(height: 4),
      Text(where('テーマ', draft.themeChoice, result.themeId), style: _mutedStyle),
      Text(where('プロジェクト', draft.projectChoice, result.projectId), style: _mutedStyle),
      if (failedAfter != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            '$failedAfter件目まで作成したところで止まりました。'
            '残りの${draft.steps.length - failedAfter}件（「${failedAfter < draft.steps.length ? draft.steps[failedAfter].title : '—'}」から）は'
            '作成されていません。',
            style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
          ),
        ),
    ];
  }

  static String _date(String v) =>
      v.length >= 10 && v[4] == '-' ? v.substring(0, 10).replaceAll('-', '/') : v;

  Widget _row(String label, String value, {Widget? trailing, String? note}) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 84, child: Text(label, style: _labelStyle)),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(value, style: const TextStyle(fontSize: 13, color: _bodyColor)),
                      if (trailing != null) trailing,
                    ],
                  ),
                  if (note != null && note.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(note, style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                    ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _placementRow(String label, RoadmapPlacement p) {
    if (p.isNone) return _row(label, 'なし', note: p.reason);
    return _row(
      label,
      p.name ?? '$label#${p.id}',
      trailing: _Tag(p.isNew ? '新規作成' : '既存'),
      note: p.isNew ? p.reason : null,
    );
  }
}

/// 置き場所の「新規作成」「既存」の小さな札
class _Tag extends StatelessWidget {
  final String text;

  const _Tag(this.text);

  @override
  Widget build(BuildContext context) {
    final isNew = text == '新規作成';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: isNew ? const Color(0xFFEDE9FE) : Colors.white,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text,
          style: TextStyle(
              fontSize: 10.5,
              color: isNew ? _violetButton : const Color(0xFF6B7280),
              fontWeight: FontWeight.w600)),
    );
  }
}

/// 質問1つ：問い、選択肢のチップ（選んでいるものが塗られる）、推奨とその理由
class _QuestionBlock extends StatelessWidget {
  final int index;
  final RoadmapQuestion question;
  final String? selected;
  final bool enabled;
  final ValueChanged<String> onSelect;

  const _QuestionBlock({
    required this.index,
    required this.question,
    required this.selected,
    required this.enabled,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final reason = question.recommendedReason;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Q${index + 1}. ${question.question}',
              style: const TextStyle(
                  fontSize: 13.5, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          const SizedBox(height: 6),
          if (question.options.isEmpty)
            const Text('（選択肢がありません。このまま作り直せます）', style: _mutedStyle)
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final o in question.options)
                  ChoiceChip(
                    key: ValueKey('rapi-roadmap-q$index-$o'),
                    label: Text(o),
                    selected: o == selected,
                    showCheckmark: false,
                    labelStyle: TextStyle(
                      fontSize: 12.5,
                      color: o == selected ? Colors.white : _bodyColor,
                      fontWeight: o == selected ? FontWeight.w600 : FontWeight.normal,
                    ),
                    selectedColor: _violetButton,
                    backgroundColor: Colors.white,
                    side: BorderSide(color: o == selected ? _violetButton : _violetBorder),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    visualDensity: VisualDensity.compact,
                    onSelected: enabled ? (_) => onSelect(o) : null,
                  ),
              ],
            ),
          if (question.recommended != null && question.recommended!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'おすすめ：${question.recommended}'
                '${reason != null && reason.isNotEmpty ? ' — $reason' : ''}',
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF6B7280), height: 1.4),
              ),
            ),
        ],
      ),
    );
  }
}

/// 手順1つ：番号・題名・期限、最終確認では説明（作られるタスクの説明そのもの）
class _StepRow extends StatelessWidget {
  final int number;
  final RoadmapStep step;
  final bool withDescription;

  const _StepRow({required this.number, required this.step, required this.withDescription});

  @override
  Widget build(BuildContext context) {
    final due = step.dueDate;
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 22,
                child: Text('$number.',
                    style: const TextStyle(
                        fontSize: 13, color: _violetButton, fontWeight: FontWeight.w600)),
              ),
              Expanded(
                child: Text(step.title,
                    style: const TextStyle(
                        fontSize: 13, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
              ),
              if (due != null)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(RapiRoadmapCardView._date(due),
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF9CA3AF))),
                ),
            ],
          ),
          if (withDescription && step.description.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 22, top: 3),
              child: Text(step.description, style: _mutedStyle),
            ),
          // 段B：完了条件を誰が確かめるか（説明文の「## 完了条件」の内訳）
          if (withDescription && rapiCriteriaSummary(step.criteriaItems) != null)
            Padding(
              padding: const EdgeInsets.only(left: 22, top: 4),
              child: Text(rapiCriteriaSummary(step.criteriaItems)!,
                  style: const TextStyle(fontSize: 11, color: _violetButton)),
            ),
        ],
      ),
    );
  }
}
