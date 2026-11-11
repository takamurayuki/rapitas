import 'package:flutter/material.dart';
import '../models/rapi.dart';

// 起票カードの「完了条件」（設計 3章段B）。
//
// 1件ずつ、採る／外すのチェック・誰が確かめるか（陪審／本人）・確かめにくい言葉の言い換えの案・
// ラピが補った条件かを出し、下に spec-quality-checker の採点を1行で添える。
// 見た目は起票カード（rapi_screen.dart）の紫の枠にそろえる。
//
// NOTE: 「誰が確かめるか」は表示だけ。採った条件はすべて acceptanceCriteria の列に入る
// （本人が確かめる条件を別の列に分けるかは未決。設計 Q2）。

const _violet = Color(0xFF7C3AED);
const _body = Color(0xFF18181B);
const _muted = Color(0xFF6B7280);
const _amber = Color(0xFFB45309);

/// 完了条件の一覧（採否のチェック付き）
class RapiCriteriaList extends StatelessWidget {
  final List<RapiCriterionItem> items;

  /// 外した条件の番号
  final Set<int> excluded;
  final RapiCriteriaQuality? quality;

  /// ラピの仮の案（読み取った案が無かった）か
  final bool fallback;

  /// null なら押せない（作成中）
  final ValueChanged<int>? onToggle;

  const RapiCriteriaList({
    super.key,
    required this.items,
    this.excluded = const {},
    this.quality,
    this.fallback = false,
    this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final chosen = items.length - excluded.where((i) => i < items.length).length;
    final q = quality;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('完了条件', style: TextStyle(fontSize: 12, color: _muted)),
            const Spacer(),
            Text('$chosen / ${items.length}件を採用',
                style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
          ],
        ),
        for (var i = 0; i < items.length; i++)
          _CriterionRow(
            key: ValueKey('rapi-criterion-$i'),
            item: items[i],
            selected: !excluded.contains(i),
            onToggle: onToggle == null ? null : () => onToggle!(i),
          ),
        if (chosen == 0)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('完了条件を1つ以上残してください。', style: TextStyle(fontSize: 12, color: _amber)),
          ),
        if (q != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '仕様の採点 ${q.score}/100（70以上が目安）'
              '${q.vagueCount > 0 ? '・確かめにくい条件 ${q.vagueCount}件' : ''}',
              key: const ValueKey('rapi-criteria-quality'),
              style: TextStyle(fontSize: 11.5, color: q.isAdequate ? _muted : _amber),
            ),
          ),
        if (fallback)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'ラピの仮の案です。合わないものは外し、文言はデスクトップのタスク編集で直してください。',
              style: TextStyle(fontSize: 12, color: _amber, height: 1.4),
            ),
          ),
      ],
    );
  }
}

class _CriterionRow extends StatelessWidget {
  final RapiCriterionItem item;
  final bool selected;
  final VoidCallback? onToggle;

  const _CriterionRow({super.key, required this.item, required this.selected, this.onToggle});

  @override
  Widget build(BuildContext context) {
    final user = item.verifier == RapiCriterionVerifier.user;
    final textStyle = TextStyle(
      fontSize: 13,
      height: 1.45,
      color: selected ? _body : const Color(0xFF9CA3AF),
      decoration: selected ? null : TextDecoration.lineThrough,
    );
    return InkWell(
      onTap: onToggle,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1, right: 6),
              child: Icon(
                selected ? Icons.check_box : Icons.check_box_outline_blank,
                size: 18,
                color: selected ? _violet : const Color(0xFF9CA3AF),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.text, style: textStyle),
                  const SizedBox(height: 3),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      _Tag(
                        label: item.verifierLabel,
                        color: !selected
                            ? const Color(0xFF9CA3AF)
                            : user
                                ? const Color(0xFF0F766E)
                                : _violet,
                        background: user ? const Color(0xFFF0FDFA) : const Color(0xFFF5F3FF),
                      ),
                      if (item.supplemented)
                        const _Tag(
                          label: 'ラピが補った案',
                          color: _muted,
                          background: Color(0xFFF4F4F5),
                        ),
                    ],
                  ),
                  // 外した条件には言い換えの案を出さない（もう送らないので、警告として残すと紛らわしい）
                  if (selected && item.vagueTerm != null && item.vagueSuggestion != null)
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
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  final Color color;
  final Color background;

  const _Tag({required this.label, required this.color, required this.background});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(4)),
      child: Text(label, style: TextStyle(fontSize: 10.5, color: color, height: 1.4)),
    );
  }
}

/// 計画の手順に添える、完了条件の判定者の内訳（例「完了条件 3件：陪審 2・本人 1」）
String? rapiCriteriaSummary(List<RapiCriterionItem> items) {
  if (items.isEmpty) return null;
  final user = items.where((i) => i.verifier == RapiCriterionVerifier.user).length;
  final vague = items.where((i) => i.vagueTerm != null).length;
  return '完了条件 ${items.length}件：陪審が確かめる ${items.length - user}・本人が確かめる $user'
      '${vague > 0 ? '・確かめにくい $vague' : ''}';
}
