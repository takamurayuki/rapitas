import 'package:flutter/material.dart';
import '../models/task.dart';
import '../utils/date_formatter.dart';
import 'status_badge.dart';
import 'priority_indicator.dart';

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
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      task.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (task.agentExecutable)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: Icon(
                        Icons.smart_toy,
                        size: 18,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                ],
              ),
              if (task.description != null && task.description!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    task.description!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withOpacity(0.6),
                        ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              const SizedBox(height: 12),
              Row(
                children: [
                  StatusBadge.task(status: task.status),
                  const SizedBox(width: 8),
                  PriorityIndicator(priority: task.priority),
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
              if (task.theme != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Chip(
                    label: Text(
                      task.theme!.name,
                      style: const TextStyle(fontSize: 11),
                    ),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
