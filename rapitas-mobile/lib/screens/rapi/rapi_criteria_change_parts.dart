import 'package:flutter/material.dart';
import '../../models/rapi.dart';
import '../../widgets/rapi_criteria_row.dart';

// 完了条件の変更カード（rapi_criteria_change_card.dart）の部品：差分1行と、段階ごとのボタンの並び。
// 色はカード本体と変更カード（rapi_screen.dart の _ChangeCard）にそろえる。

const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _bodyColor = Color(0xFF18181B);
const _muted = Color(0xFF6B7280);
const _faint = Color(0xFF9CA3AF);
const _doneGreen = Color(0xFF047857);
const _removeRed = Color(0xFFB91C1C);

/// 段階ごとのボタン：直す（下書きを作る）・確かめる（確定・直す・やめる／作り直す）・確定後（取り消す）
class RapiCriteriaChangeButtons extends StatelessWidget {
  final RapiCriteriaCard card;
  final VoidCallback onDraft;
  final VoidCallback onApply;
  final VoidCallback onBack;
  final VoidCallback onRebuild;
  final VoidCallback onCancel;
  final VoidCallback onRevert;
  final VoidCallback onOpen;

  /// 読み込んだ記録のカード。「タスクを開く」だけを出す
  final bool readOnly;

  const RapiCriteriaChangeButtons({
    super.key,
    required this.card,
    required this.onDraft,
    required this.onApply,
    required this.onBack,
    required this.onRebuild,
    required this.onCancel,
    required this.onRevert,
    required this.onOpen,
    this.readOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    final phase = card.phase;
    if (readOnly) {
      return Row(children: [
        const Spacer(),
        TextButton(
          key: const ValueKey('rapi-criteria-open'),
          style: TextButton.styleFrom(foregroundColor: _violetButton),
          onPressed: onOpen,
          child: const Text('タスクを開く'),
        ),
      ]);
    }
    final primary = FilledButton.styleFrom(
      backgroundColor: _violetButton,
      foregroundColor: Colors.white,
      disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
      disabledForegroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    );
    final quiet = TextButton.styleFrom(foregroundColor: _muted);
    Widget cancel() => TextButton(
          key: const ValueKey('rapi-criteria-cancel'),
          style: quiet,
          onPressed: onCancel,
          child: const Text('やめる'),
        );

    if (phase == RapiCriteriaPhase.editing || phase == RapiCriteriaPhase.drafting) {
      final drafting = phase == RapiCriteriaPhase.drafting;
      return Row(children: [
        Expanded(
          child: FilledButton(
            key: const ValueKey('rapi-criteria-draft'),
            style: primary,
            onPressed: card.canDraft ? onDraft : null,
            child: Text(drafting ? '下書きを作っています…' : '下書きを作る'),
          ),
        ),
        const SizedBox(width: 8),
        if (!drafting) cancel(),
      ]);
    }
    if (phase == RapiCriteriaPhase.proposed || phase == RapiCriteriaPhase.applying) {
      if (card.refusal == 'criteria_changed_since') {
        return Row(children: [
          Expanded(
            child: FilledButton(
              key: const ValueKey('rapi-criteria-rebuild'),
              style: primary,
              onPressed: onRebuild,
              child: const Text('最新の条件で作り直す'),
            ),
          ),
          const SizedBox(width: 8),
          cancel(),
        ]);
      }
      if (!card.canApply && phase != RapiCriteriaPhase.applying) {
        // 判定中・完了後など、いま変えられない。押せる確定は出さない
        return Row(children: [
          const Spacer(),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: _violetButton),
            onPressed: onOpen,
            child: const Text('タスクを開く'),
          ),
          cancel(),
        ]);
      }
      final applying = phase == RapiCriteriaPhase.applying;
      return Row(children: [
        Expanded(
          child: FilledButton(
            key: const ValueKey('rapi-criteria-apply'),
            style: primary,
            onPressed: applying ? null : onApply,
            child: Text(applying ? '変更しています…' : 'この内容で確定'),
          ),
        ),
        const SizedBox(width: 4),
        TextButton(
          key: const ValueKey('rapi-criteria-back'),
          style: TextButton.styleFrom(foregroundColor: _violetButton),
          onPressed: applying ? null : onBack,
          child: const Text('直す'),
        ),
        if (!applying) cancel(),
      ]);
    }
    return Row(children: [
      if (card.canRevert || phase == RapiCriteriaPhase.reverting)
        OutlinedButton.icon(
          key: const ValueKey('rapi-criteria-revert'),
          style: OutlinedButton.styleFrom(
            foregroundColor: _violetButton,
            side: const BorderSide(color: _violetBorder),
            backgroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          onPressed: card.canRevert ? onRevert : null,
          icon: const Icon(Icons.undo, size: 18),
          label: Text(phase == RapiCriteriaPhase.reverting ? '元に戻しています…' : '取り消す'),
        ),
      const Spacer(),
      TextButton(
        key: const ValueKey('rapi-criteria-open'),
        style: TextButton.styleFrom(foregroundColor: _violetButton),
        onPressed: onOpen,
        child: const Text('タスクを開く'),
      ),
    ]);
  }}

/// 差分1行：種類のタグと文（言い換えは「前 → 後」）
class RapiCriteriaDiffRowView extends StatelessWidget {
  final RapiCriteriaDiffRow row;

  const RapiCriteriaDiffRowView({super.key, required this.row});

  @override
  Widget build(BuildContext context) {
    final (label, color, background) = switch (row.kind) {
      RapiCriteriaDiffKind.added => ('足す', _doneGreen, const Color(0xFFECFDF5)),
      RapiCriteriaDiffKind.removed => ('消す', _removeRed, const Color(0xFFFEF2F2)),
      RapiCriteriaDiffKind.reworded => ('言い換え', _violetButton, Colors.white),
    };
    const body = TextStyle(fontSize: 13, height: 1.45, color: _bodyColor);
    final Widget text = switch (row.kind) {
      RapiCriteriaDiffKind.added => Text(row.after ?? '', style: body),
      RapiCriteriaDiffKind.removed => Text(row.before ?? '',
          style: body.copyWith(color: _faint, decoration: TextDecoration.lineThrough)),
      RapiCriteriaDiffKind.reworded => Text.rich(TextSpan(children: [
          TextSpan(
              text: row.before ?? '',
              style: const TextStyle(color: _faint, decoration: TextDecoration.lineThrough)),
          const TextSpan(text: '  →  ', style: TextStyle(color: _faint)),
          TextSpan(text: row.after ?? ''),
        ]), style: body),
    };
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1, right: 8),
            child: RapiCriterionTag(label: label, color: color, background: background),
          ),
          Expanded(child: text),
        ],
      ),
    );
  }
}
