/// サブタスクの進捗表示（完了数／総数＋区切りバー）。
///
/// デスクトップのタスクカード（rapitas-frontend の TaskCardSubtaskProgress）と同じ内容を出す：
/// - 数字は「完了数/総数」。完了は status == 'done' だけを数える
/// - バーは緑（完了）＋青（進行中。'blocked' も進行中として数える）を左から並べ、残りは灰色の地
/// - 全部完了なら数字は緑、それ以外は青
/// - サブタスクが無ければ何も出さない
library;

import 'package:flutter/material.dart';
import '../models/task.dart';
import '../utils/constants.dart';

/// サブタスクの状態ごとの件数。デスクトップの集計と同じ数え方。
class SubtaskProgressCounts {
  final int total;
  final int done;
  final int inProgress;

  const SubtaskProgressCounts({
    required this.total,
    required this.done,
    required this.inProgress,
  });

  /// サブタスク一覧から件数を数える。
  ///
  /// @param subtasks - 親タスクのサブタスク / null は 0 件として扱う
  /// @returns 件数 / 進行中には 'in-progress' と 'blocked' を含める
  factory SubtaskProgressCounts.fromSubtasks(List<Task>? subtasks) {
    final list = subtasks ?? const <Task>[];
    return SubtaskProgressCounts(
      total: list.length,
      done: list.where((s) => s.status == 'done').length,
      // NOTE: デスクトップの isInProgressStatus と同じく 'blocked' は進行中に含める
      inProgress:
          list.where((s) => s.status == 'in-progress' || s.status == 'blocked').length,
    );
  }

  int get todo => total - done - inProgress;
  bool get isComplete => total > 0 && done == total;

  /// 完了部分の幅（%）。デスクトップと同じく四捨五入した整数。
  int get donePercent => total == 0 ? 0 : (done / total * 100).round();

  /// 進行中部分の幅（%）。
  int get inProgressPercent => total == 0 ? 0 : (inProgress / total * 100).round();

  /// 内訳の文言（デスクトップのツールチップと同じ並び）。
  String get breakdown => '${AppConstants.statusLabels['done']} $done / '
      '${AppConstants.statusLabels['in-progress']} $inProgress / '
      '${AppConstants.statusLabels['todo']} $todo';
}

/// デスクトップと同じ配色（Tailwind の green/blue/zinc）。明暗で切り替える。
class SubtaskProgressColors {
  static Color text(BuildContext context, {required bool complete}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (complete) return dark ? const Color(0xFF4ADE80) : const Color(0xFF16A34A);
    return dark ? const Color(0xFF60A5FA) : const Color(0xFF2563EB);
  }

  static const Color doneSegment = Color(0xFF22C55E);
  static const Color inProgressSegment = Color(0xFF3B82F6);

  static Color track(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
          ? const Color(0xFF3F3F46)
          : const Color(0xFFE4E4E7);
}

/// 「完了数/総数」とバーを横に並べた進捗表示。サブタスクが無ければ空。
class SubtaskProgress extends StatelessWidget {
  final List<Task>? subtasks;

  /// バーの幅。null なら残りの幅いっぱいに伸ばす（詳細画面用）
  final double? barWidth;

  const SubtaskProgress({super.key, required this.subtasks, this.barWidth});

  @override
  Widget build(BuildContext context) {
    final counts = SubtaskProgressCounts.fromSubtasks(subtasks);
    if (counts.total == 0) return const SizedBox.shrink();

    final color = SubtaskProgressColors.text(context, complete: counts.isComplete);
    final bar = SubtaskProgressBar(counts: counts);
    return Semantics(
      label: 'サブタスク ${counts.done}/${counts.total}',
      excludeSemantics: true,
      child: Tooltip(
        message: counts.breakdown,
        child: Row(
          mainAxisSize: barWidth == null ? MainAxisSize.max : MainAxisSize.min,
          children: [
            Text(
              '${counts.done}/${counts.total}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
            ),
            const SizedBox(width: 6),
            if (barWidth != null)
              SizedBox(width: barWidth, child: bar)
            else
              Expanded(child: bar),
          ],
        ),
      ),
    );
  }
}

/// 灰色の地に緑（完了）・青（進行中）の区間を左から並べた細いバー。
class SubtaskProgressBar extends StatelessWidget {
  final SubtaskProgressCounts counts;

  const SubtaskProgressBar({super.key, required this.counts});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: 6,
        child: ColoredBox(
          color: SubtaskProgressColors.track(context),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              return Row(
                children: [
                  Container(
                    key: const ValueKey('subtask-progress-done'),
                    width: width * counts.donePercent / 100,
                    color: SubtaskProgressColors.doneSegment,
                  ),
                  Container(
                    key: const ValueKey('subtask-progress-in-progress'),
                    // 四捨五入の合計が 100% を超えても地からはみ出さないよう残り幅で抑える
                    width: (width * counts.inProgressPercent / 100)
                        .clamp(0.0, width * (100 - counts.donePercent) / 100),
                    color: SubtaskProgressColors.inProgressSegment,
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
