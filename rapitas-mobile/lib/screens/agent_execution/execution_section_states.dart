import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'exec_filter_bar.dart';

// 実行画面の各セクションで共通の状態表示（取得失敗・本当に空・条件に合うものなし・件数）。
// NOTE: SectionError / ExecutingEmptyState は agent_execution_screen.dart から移した（画面ファイルを大きくしないため）。

/// セクション単位の取得失敗表示。もう片方のセクションはそのまま出す。
class SectionError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const SectionError({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.only(left: 16, right: 8),
        child: Row(
          children: [
            Icon(Icons.error_outline, size: 20, color: colorScheme.error),
            const SizedBox(width: 8),
            Expanded(child: Text(message)),
            TextButton(onPressed: onRetry, child: const Text('再試行')),
          ],
        ),
      ),
    );
  }
}

/// 実行中が空のときの表示。見出し「実行中」の直下に、枠つきのブロックで目立たせる。
/// 絞り込みが無く、本当に0件のときだけ出す（条件に合わないだけなら [ExecNoMatch]）
class ExecutingEmptyState extends StatelessWidget {
  const ExecutingEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      key: const ValueKey('executing-empty'),
      margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: Border.all(color: colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.play_circle_outline, size: 36, color: colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              '実行中のタスクはありません',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }
}

/// 絞り込みの結果が0件のときの表示（本当に空のときの表示とは別）。条件のクリアも置く
class ExecNoMatch extends ConsumerWidget {
  final String text;

  const ExecNoMatch({super.key, this.text = '条件に合うタスクはありません'});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
        child: Row(
          children: [
            Icon(Icons.filter_alt_outlined, size: 20, color: colorScheme.onSurfaceVariant),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
            TextButton(onPressed: () => clearExecFilter(ref), child: const Text('条件をクリア')),
          ],
        ),
      ),
    );
  }
}

/// 絞り込み中に見出しの直下へ出す件数（例：3件中1件）
class FilterCountLine extends StatelessWidget {
  final int total;
  final int shown;

  const FilterCountLine({super.key, required this.total, required this.shown});

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
      child: Text('$total件中$shown件', style: style),
    );
  }
}
