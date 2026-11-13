import 'package:flutter/material.dart';
import '../models/task.dart';
import '../utils/color_utils.dart';
import '../utils/date_formatter.dart';
import 'status_badge.dart';
import 'priority_indicator.dart';
import 'subtask_progress.dart';

class TaskCard extends StatelessWidget {
  final Task task;
  final VoidCallback? onTap;
  final ValueChanged<String>? onStatusChanged;

  const TaskCard({
    super.key,
    required this.task,
    this.onTap,
    this.onStatusChanged,
  });

  /// 期限の表示色。期限切れ（未完了）は赤系、今日が期限（未完了）は橙系、それ以外はグレー。
  /// 時刻は落として日単位で比べる。
  Color _dueDateColor(BuildContext context, DateTime dueDate) {
    final defaultColor = Theme.of(context).colorScheme.onSurface.withOpacity(0.5);
    if (task.status == 'done') return defaultColor;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dueDay = DateTime(dueDate.year, dueDate.month, dueDate.day);
    if (dueDay.isBefore(today)) return Theme.of(context).colorScheme.error;
    if (dueDay == today) return Colors.orange;
    return defaultColor;
  }

  @override
  Widget build(BuildContext context) {
    final dueDate = task.dueDate;
    final dueDateColor = dueDate != null ? _dueDateColor(context, dueDate) : null;

    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1行目：タイトル（1行省略）＋右端にエージェントアイコン・テーマラベル
              Row(
                children: [
                  Expanded(
                    child: Text(
                      task.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (task.agentExecutable)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: Icon(
                        Icons.smart_toy,
                        size: 16,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  if (task.theme != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      // 長いテーマ名でタイトルを圧迫しないよう幅を制限する
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 140),
                        child: _ThemeChipLabel(theme: task.theme!),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              // 2行目：ステータス＋優先度＋右端に期限
              Row(
                children: [
                  StatusBadge.task(status: task.status),
                  const SizedBox(width: 8),
                  PriorityIndicator(priority: task.priority),
                  // デスクトップのタスクカードと同じく、ステータス・優先度の並びに進捗を出す
                  // （バーはデスクトップの狭い幅と同じ 80px を上限に、期限と並ばないときは縮める）
                  if (task.subtasks?.isNotEmpty ?? false)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(left: 8, right: 8),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 112),
                            child: SubtaskProgress(subtasks: task.subtasks),
                          ),
                        ),
                      ),
                    )
                  else
                    const Spacer(),
                  if (dueDate != null)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.calendar_today,
                          size: 14,
                          color: dueDateColor,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          DateFormatter.formatDate(dueDate),
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: dueDateColor,
                                  ),
                        ),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// テーマラベル（色ドット＋名前）。テーマ色がパースできなければ名前のみ。
/// 名前は1行省略（親の最大幅に収める）。
class _ThemeChipLabel extends StatelessWidget {
  final TaskTheme theme;

  const _ThemeChipLabel({required this.theme});

  @override
  Widget build(BuildContext context) {
    final color = ColorUtils.parseColor(theme.color);
    final text = Text(
      theme.name,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            fontSize: 11,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      softWrap: false,
    );
    final scheme = Theme.of(context).colorScheme;
    // 承認済みモックの小さなピル（薄い背景＋細い枠、角丸8）
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (color != null) ...[
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 4),
          ],
          Flexible(child: text),
        ],
      ),
    );
  }
}
