import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

// バックログ3画面（アイデア／懸念／仮説）で共通の小物

final DateFormat _dateFormat = DateFormat('yyyy/MM/dd');

/// 作成日の表示（不明なら空文字）
String formatBacklogDate(DateTime? date) =>
    date == null ? '' : _dateFormat.format(date.toLocal());

/// 優先度・重要度に対応する色。緊急・高だけ色を付け、他は控えめな既定色。
Color? backlogPriorityColor(String value) {
  switch (value) {
    case 'urgent':
      return Colors.red;
    case 'high':
      return Colors.deepOrange;
    default:
      return null;
  }
}

/// 小さなラベルチップ。color を渡すとその色の淡い背景＋濃い文字になる。
class BacklogChip extends StatelessWidget {
  final String label;
  final Color? color;

  const BacklogChip({super.key, required this.label, this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tint = color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: tint != null
            ? tint.withOpacity(0.12)
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(4),
      ),
      // NOTE: テーマ名など長くなりうるラベルが行からはみ出さないよう1行で省略する
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.labelSmall?.copyWith(
          color: tint ?? theme.colorScheme.onSurfaceVariant,
          fontWeight: tint != null ? FontWeight.w600 : null,
        ),
      ),
    );
  }
}

/// 削除の確認ダイアログ。削除するなら true。
Future<bool> confirmBacklogDelete(BuildContext context, String message) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('削除しますか？'),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('キャンセル'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.error,
          ),
          child: const Text('削除'),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}
