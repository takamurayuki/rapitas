import 'package:flutter/material.dart';
import '../models/rapi.dart';

// 完了条件の一覧（rapi_criteria_list.dart）の1行ぶんの部品：表示の行・文言を直す行・タグ。

const _violet = Color(0xFF7C3AED);
const _body = Color(0xFF18181B);
const _muted = Color(0xFF6B7280);
const _faint = Color(0xFF9CA3AF);
const _amber = Color(0xFFB45309);
const _teal = Color(0xFF0F766E);

/// 完了条件1件の行：採否のチェック・文・判定者などのタグ・言い換えの案・鉛筆
class RapiCriterionRow extends StatelessWidget {
  final String keyPrefix;
  final RapiCriterionItem item;
  final bool selected;
  final VoidCallback? onToggle;
  final VoidCallback? onEdit;

  const RapiCriterionRow({
    super.key,
    required this.keyPrefix,
    required this.item,
    required this.selected,
    this.onToggle,
    this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final user = item.verifier == RapiCriterionVerifier.user;
    final textStyle = TextStyle(
      fontSize: 13,
      height: 1.45,
      color: selected ? _body : _faint,
      decoration: selected ? null : TextDecoration.lineThrough,
    );
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            key: ValueKey('$keyPrefix-toggle'),
            onTap: onToggle,
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.only(top: 1, right: 6),
              child: Icon(
                selected ? Icons.check_box : Icons.check_box_outline_blank,
                size: 18,
                color: selected ? _violet : _faint,
              ),
            ),
          ),
          Expanded(
            child: InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.text, style: textStyle),
                  const SizedBox(height: 3),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      if (item.pending)
                        const RapiCriterionTag(
                            label: '判定を確認中', color: _muted, background: Color(0xFFF4F4F5))
                      else
                        RapiCriterionTag(
                          label: item.verifierLabel,
                          color: !selected
                              ? _faint
                              : user
                                  ? _teal
                                  : _violet,
                          // 陪審のタグは起票カードの地（F5F3FF）と同じ色だと枠が消えるので、一段濃くする
                          background: user ? const Color(0xFFF0FDFA) : const Color(0xFFEDE9FE),
                        ),
                      if (item.edited)
                        const RapiCriterionTag(
                            label: '直した文', color: _muted, background: Color(0xFFF4F4F5))
                      else if (item.supplemented)
                        const RapiCriterionTag(
                            label: 'ラピが補った案', color: _muted, background: Color(0xFFF4F4F5)),
                      if (item.generic && selected)
                        const RapiCriterionTag(
                            label: '仮の文', color: _amber, background: Color(0xFFFFFBEB)),
                    ],
                  ),
                  // 外した条件には言い換えの案を出さない（もう送らないので、警告として残すと紛らわしい）
                  if (selected &&
                      !item.pending &&
                      item.vagueTerm != null &&
                      item.vagueSuggestion != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        '「${item.vagueTerm}」は確かめにくい言葉です。言い換えの案：${item.vagueSuggestion}',
                        style: const TextStyle(fontSize: 11.5, color: _amber, height: 1.4),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (onEdit != null)
            SizedBox(
              width: 32,
              height: 28,
              child: IconButton(
                key: ValueKey('$keyPrefix-edit'),
                padding: EdgeInsets.zero,
                tooltip: '文言を直す',
                icon: const Icon(Icons.edit_outlined, size: 17, color: _muted),
                onPressed: onEdit,
              ),
            ),
        ],
      ),
    );
  }
}

/// 文言を直している行：入力欄と「決定」「やめる」
class RapiCriterionEditRow extends StatelessWidget {
  final String keyPrefix;
  final TextEditingController controller;
  final VoidCallback onSave;
  final VoidCallback onCancel;

  const RapiCriterionEditRow({
    super.key,
    required this.keyPrefix,
    required this.controller,
    required this.onSave,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          TextField(
            key: ValueKey('$keyPrefix-field'),
            controller: controller,
            autofocus: true,
            minLines: 1,
            maxLines: 4,
            maxLength: 500,
            style: const TextStyle(fontSize: 13, height: 1.45, color: _body),
            decoration: const InputDecoration(
              isDense: true,
              counterText: '',
              filled: true,
              fillColor: Colors.white,
              hintText: '何ができたら終わりか（操作・結果・確かめる材料）',
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              border: OutlineInputBorder(),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                key: ValueKey('$keyPrefix-cancel'),
                onPressed: onCancel,
                child: const Text('やめる'),
              ),
              TextButton(
                key: ValueKey('$keyPrefix-save'),
                onPressed: onSave,
                child: const Text('決定'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 判定者・補った案などの小さなタグ
class RapiCriterionTag extends StatelessWidget {
  final String label;
  final Color color;
  final Color background;

  const RapiCriterionTag({
    super.key,
    required this.label,
    required this.color,
    required this.background,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(4)),
      child: Text(label, style: TextStyle(fontSize: 10.5, color: color, height: 1.4)),
    );
  }
}
