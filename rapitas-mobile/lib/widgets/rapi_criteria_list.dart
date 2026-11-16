import 'package:flutter/material.dart';
import '../models/rapi.dart';
import 'rapi_criteria_row.dart';

// 確定前の「完了条件」の一覧（設計 3章段B）。起票カードと計画カードの手順ごとに使う。
//
// 1件ずつ、採る／外すのチェック・誰が確かめるか（陪審／本人）・確かめにくい言葉の言い換えの案・
// ラピが補った条件か・仮の文か を出し、鉛筆でその場で文言を直せる。下に spec-quality-checker の
// 採点を1行で添える。直した文の判定と採点はサーバーに問い合わせ直す（届くまで「確認中」）。
// 保存先は判定者で分かれる：陪審が確かめる条件は完了判定に使う列、本人が確かめる条件は別の列。
// 見た目は起票カード（rapi_screen.dart）の紫の枠にそろえる。

const _muted = Color(0xFF6B7280);
const _faint = Color(0xFF9CA3AF);
const _amber = Color(0xFFB45309);

/// 完了条件の一覧（採否のチェック・文言の編集付き）
class RapiCriteriaList extends StatefulWidget {
  final RapiCriteriaEdit edit;

  /// 行の Key の頭（1画面に複数の一覧を出すとき、手順ごとに変える）
  final String keyPrefix;

  /// 見出しの文（計画カードでは手順の中なので短くする）
  final String heading;

  /// null なら押せない（作成中・確定後）
  final ValueChanged<int>? onToggle;
  final void Function(int index, String text)? onEdit;

  const RapiCriteriaList({
    super.key,
    required this.edit,
    this.keyPrefix = 'rapi-criterion',
    this.heading = '完了条件',
    this.onToggle,
    this.onEdit,
  });

  @override
  State<RapiCriteriaList> createState() => _RapiCriteriaListState();
}

class _RapiCriteriaListState extends State<RapiCriteriaList> {
  int? _editing;
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _startEdit(int index) {
    setState(() {
      _editing = index;
      _controller.text = widget.edit.items[index].text;
    });
  }

  void _finishEdit({required bool save}) {
    final index = _editing;
    if (index == null) return;
    if (save) widget.onEdit?.call(index, _controller.text);
    setState(() => _editing = null);
  }

  @override
  Widget build(BuildContext context) {
    final edit = widget.edit;
    final items = edit.items;
    final chosen = edit.selected.length;
    final q = edit.quality;
    final enabled = widget.onToggle != null;
    final generic = [
      for (var i = 0; i < items.length; i++)
        if (!edit.excluded.contains(i) && items[i].generic) i,
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(widget.heading, style: const TextStyle(fontSize: 12, color: _muted)),
            const Spacer(),
            Text('$chosen / ${items.length}件を採用',
                style: const TextStyle(fontSize: 11, color: _faint)),
          ],
        ),
        for (var i = 0; i < items.length; i++)
          if (_editing == i)
            RapiCriterionEditRow(
              key: ValueKey('${widget.keyPrefix}-$i-editing'),
              keyPrefix: '${widget.keyPrefix}-$i',
              controller: _controller,
              onSave: () => _finishEdit(save: true),
              onCancel: () => _finishEdit(save: false),
            )
          else
            RapiCriterionRow(
              key: ValueKey('${widget.keyPrefix}-$i'),
              keyPrefix: '${widget.keyPrefix}-$i',
              item: items[i],
              selected: !edit.excluded.contains(i),
              onToggle: enabled ? () => widget.onToggle!(i) : null,
              onEdit:
                  enabled && widget.onEdit != null && _editing == null ? () => _startEdit(i) : null,
            ),
        if (chosen == 0)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('完了条件を1つ以上残してください。', style: TextStyle(fontSize: 12, color: _amber)),
          ),
        if (generic.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '仮の文が${generic.length}件あります。鉛筆から、何ができたら終わりかが分かる文に直してください。',
              key: ValueKey('${widget.keyPrefix}-generic-note'),
              style: const TextStyle(fontSize: 12, color: _amber, height: 1.4),
            ),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            edit.pending
                ? '直した条件を確認しています…'
                : edit.reviewFailed
                    ? '直した条件の判定を確かめられませんでした。作成するときにサーバーが判定します。'
                    : q == null
                        ? ''
                        : '仕様の採点 ${q.score}/100（70以上が目安）'
                            '${q.vagueCount > 0 ? '・確かめにくい条件 ${q.vagueCount}件' : ''}',
            key: ValueKey('${widget.keyPrefix}-quality'),
            style: TextStyle(
              fontSize: 11.5,
              color: edit.reviewFailed || (q != null && !q.isAdequate && !edit.pending)
                  ? _amber
                  : _muted,
            ),
          ),
        ),
        // 一度でも直したら、もう「ラピの仮の案」ではないので出さない
        if (edit.fallback && generic.isEmpty && !items.any((i) => i.edited))
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'ラピの仮の案です。合わないものは外すか、鉛筆から直してください。',
              style: TextStyle(fontSize: 12, color: _amber, height: 1.4),
            ),
          ),
      ],
    );
  }
}
