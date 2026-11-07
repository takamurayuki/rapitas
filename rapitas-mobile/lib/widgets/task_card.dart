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

  @override
  Widget build(BuildContext context) {
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
                  if (task.dueDate != null)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.calendar_today,
                          size: 14,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withOpacity(0.5),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          DateFormatter.formatDate(task.dueDate),
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurface
                                        .withOpacity(0.5),
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
