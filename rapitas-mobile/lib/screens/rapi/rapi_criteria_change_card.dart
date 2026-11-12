import 'package:flutter/material.dart';
import '../../models/rapi.dart';
import '../../widgets/rapi_criteria_list.dart';
import '../../widgets/rapi_criteria_row.dart';
import 'rapi_criteria_change_parts.dart';

// 既存タスクの完了条件を変えるカード（設計 段E・§7 第2段階 項目3）。
//
// 直す：今の条件の一覧（外す・鉛筆で言い換え・足す）と変える理由 →「下書きを作る」
// 確かめる：差分（足す・消す・言い換え）と理由 →「この内容で確定」「直す」「やめる」
//   版がずれて断られたら「最新の条件で作り直す」。判定中・完了後は理由を出して確定させない
// 確定後：変わった差分と「取り消す」「タスクを開く」
// 会話スペースから読み込んだ記録（readOnly）は、操作のボタンを出さず「タスクを開く」だけにする
// （変更カードの readOnly と同じ。設計 nav39 5.3.1）。
// 見た目は変更カード（rapi_screen.dart の _ChangeCard）と起票カードの完了条件の一覧にそろえる。

const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
const _bodyColor = Color(0xFF18181B);
const _muted = Color(0xFF6B7280);
const _warnAmber = Color(0xFFB45309);
const _doneGreen = Color(0xFF047857);

class RapiCriteriaChangeCardView extends StatefulWidget {
  final RapiCriteriaCard card;
  final ValueChanged<int> onToggle;
  final void Function(int index, String text) onEdit;
  final ValueChanged<String> onAdd;
  final ValueChanged<String> onReason;
  final VoidCallback onDraft;
  final VoidCallback onApply;
  final VoidCallback onBack;
  final VoidCallback onRebuild;
  final VoidCallback onCancel;
  final VoidCallback onRevert;
  final VoidCallback onOpen;

  /// 読み込んだ記録（archived）のカードか。操作のボタン・入力欄を出さない
  final bool readOnly;

  const RapiCriteriaChangeCardView({
    super.key,
    required this.card,
    required this.onToggle,
    required this.onEdit,
    required this.onAdd,
    required this.onReason,
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
  State<RapiCriteriaChangeCardView> createState() => _RapiCriteriaChangeCardViewState();
}

class _RapiCriteriaChangeCardViewState extends State<RapiCriteriaChangeCardView> {
  late final TextEditingController _reason = TextEditingController(text: widget.card.reason);
  final _addition = TextEditingController();
  bool _adding = false;

  @override
  void dispose() {
    _reason.dispose();
    _addition.dispose();
    super.dispose();
  }

  void _finishAdd({required bool save}) {
    if (save) widget.onAdd(_addition.text);
    setState(() {
      _adding = false;
      _addition.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final card = widget.card;
    final phase = card.phase;
    final editing = phase == RapiCriteriaPhase.editing || phase == RapiCriteriaPhase.drafting;
    final proposed = phase == RapiCriteriaPhase.proposed || phase == RapiCriteriaPhase.applying;
    final heading = switch (phase) {
      RapiCriteriaPhase.editing || RapiCriteriaPhase.drafting => '完了条件をどう変えますか',
      RapiCriteriaPhase.proposed || RapiCriteriaPhase.applying => card.refusal ==
              'criteria_changed_since'
          ? '下書きを作り直してください'
          : card.draft?.blockedBy != null || card.refusal != null
              ? 'いまは完了条件を変えられません'
              : 'この内容で完了条件を変えますか',
      RapiCriteriaPhase.applied || RapiCriteriaPhase.reverting => '完了条件を変えました',
      RapiCriteriaPhase.reverted => '元に戻しました',
      RapiCriteriaPhase.applyUnknown => '変更できたか確かめられませんでした',
      RapiCriteriaPhase.revertUnavailable => '取り消せる記録がありません',
    };
    final IconData? headingIcon = switch (phase) {
      RapiCriteriaPhase.applied || RapiCriteriaPhase.reverting => Icons.check_circle,
      RapiCriteriaPhase.reverted => Icons.undo,
      RapiCriteriaPhase.applyUnknown => Icons.help_outline,
      RapiCriteriaPhase.revertUnavailable => Icons.info_outline,
      _ => null,
    };
    final refused = proposed && (card.refusal != null || card.draft?.blockedBy != null);
    final headingColor =
        phase == RapiCriteriaPhase.applyUnknown || refused ? _warnAmber : _violetButton;

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
              if (headingIcon != null)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(headingIcon, size: 16, color: headingColor),
                ),
              Expanded(
                child: Text(heading,
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: headingColor, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text('対象', style: _labelStyle),
          const SizedBox(height: 2),
          Text(card.title,
              style: const TextStyle(
                  fontSize: 15, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          const SizedBox(height: 8),
          if (editing) ..._editingBody(card) else if (proposed) ..._proposedBody(card) else ..._doneBody(card),
          if (card.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(card.error!,
                  key: const ValueKey('rapi-criteria-error'),
                  style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
            ),
          const SizedBox(height: 12),
          RapiCriteriaChangeButtons(
            card: card,
            onDraft: widget.onDraft,
            onApply: widget.onApply,
            onBack: widget.onBack,
            onRebuild: widget.onRebuild,
            onCancel: widget.onCancel,
            onRevert: widget.onRevert,
            onOpen: widget.onOpen,
            readOnly: widget.readOnly,
          ),
        ],
      ),
    );
  }

  List<Widget> _editingBody(RapiCriteriaCard card) {
    final enabled = card.phase == RapiCriteriaPhase.editing && !widget.readOnly;
    return [
      RapiCriteriaList(
        edit: card.edit,
        keyPrefix: 'rapi-criteria-change',
        heading: '完了条件（陪審が確かめる）',
        onToggle: enabled ? widget.onToggle : null,
        onEdit: enabled ? widget.onEdit : null,
      ),
      if (_adding)
        RapiCriterionEditRow(
          keyPrefix: 'rapi-criteria-add',
          controller: _addition,
          onSave: () => _finishAdd(save: true),
          onCancel: () => _finishAdd(save: false),
        )
      else
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const ValueKey('rapi-criteria-add'),
            style: TextButton.styleFrom(
              foregroundColor: _violetButton,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              visualDensity: VisualDensity.compact,
            ),
            onPressed: enabled ? () => setState(() => _adding = true) : null,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('条件を足す', style: TextStyle(fontSize: 13)),
          ),
        ),
      const SizedBox(height: 6),
      const Text('変える理由', style: _labelStyle),
      const SizedBox(height: 4),
      TextField(
        key: const ValueKey('rapi-criteria-reason'),
        controller: _reason,
        enabled: enabled,
        minLines: 1,
        maxLines: 3,
        maxLength: 1000,
        onChanged: widget.onReason,
        style: const TextStyle(fontSize: 13, height: 1.45, color: _bodyColor),
        decoration: const InputDecoration(
          isDense: true,
          counterText: '',
          filled: true,
          fillColor: Colors.white,
          hintText: '例：検索結果をリンクで共有したいと分かった',
          contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          border: OutlineInputBorder(),
        ),
      ),
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(
          !card.changed
              ? '条件を直す・外す・足すと、下書きを作れます（まだ何も変えません）。'
              : card.reason.trim().isEmpty
                  ? '変える理由を書くと、下書きを作れます。理由は変更の記録に残ります。'
                  : '下書きでは、変更前後の差分を確かめられます（まだ何も変えません）。',
          style: const TextStyle(fontSize: 11.5, color: _muted, height: 1.4),
        ),
      ),
    ];
  }

  List<Widget> _proposedBody(RapiCriteriaCard card) {
    final draft = card.draft;
    if (draft == null) return const [];
    final rows = card.rows;
    return [
      const Text('変更点', style: _labelStyle),
      if (rows.isEmpty)
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('変更点はありません。', style: TextStyle(fontSize: 13, color: _muted)),
        ),
      for (var i = 0; i < rows.length; i++) RapiCriteriaDiffRowView(key: ValueKey('rapi-criteria-diff-$i'), row: rows[i]),
      const SizedBox(height: 8),
      const Text('理由', style: _labelStyle),
      const SizedBox(height: 2),
      Text(draft.reason, style: const TextStyle(fontSize: 13, color: _bodyColor, height: 1.45)),
      if (draft.blockedBy != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            draft.blockedMessage ?? 'いまは完了条件を変えられません。',
            key: const ValueKey('rapi-criteria-blocked'),
            style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
          ),
        )
      else if (card.refusal == null)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            '確定すると、陪審は新しい条件でもう一度判定します。変更前後と理由は記録に残り、あとから取り消せます。',
            style: TextStyle(fontSize: 11.5, color: _muted, height: 1.4),
          ),
        ),
    ];
  }

  List<Widget> _doneBody(RapiCriteriaCard card) {
    final rows = card.rows;
    return [
      if (card.phase != RapiCriteriaPhase.applyUnknown) ...[
        const Text('変更点', style: _labelStyle),
        for (var i = 0; i < rows.length; i++) RapiCriteriaDiffRowView(key: ValueKey('rapi-criteria-diff-$i'), row: rows[i]),
      ],
      if (card.phase == RapiCriteriaPhase.applied && card.refusal == null)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('変更前後と理由を記録しました。次の確認から、陪審は新しい条件で判定します。',
              style: TextStyle(fontSize: 12, color: _doneGreen, height: 1.4)),
        ),
      if (card.phase == RapiCriteriaPhase.reverted)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('変更前の完了条件に戻しました。',
              style: TextStyle(fontSize: 12, color: _doneGreen)),
        ),
      if (card.phase == RapiCriteriaPhase.applyUnknown)
        const Text(
          '応答がなく、この変更が反映されたか確かめられませんでした。反映済みの場合もあるため、'
          'ここからは確定し直せません。タスクを開いて今の完了条件を確かめてください。',
          style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
        ),
      if (card.phase == RapiCriteriaPhase.revertUnavailable)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('既に取り消し済みの可能性があります。今の完了条件はタスクを開いて確かめてください。',
              style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
        ),
    ];
  }


}
