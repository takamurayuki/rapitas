import 'package:flutter/material.dart';
import '../utils/color_utils.dart';
import '../utils/constants.dart';

enum StatusBadgeType { task, execution, approval }

class StatusBadge extends StatelessWidget {
  final String status;
  final StatusBadgeType type;

  const StatusBadge.task({
    super.key,
    required this.status,
  }) : type = StatusBadgeType.task;

  const StatusBadge.execution({
    super.key,
    required this.status,
  }) : type = StatusBadgeType.execution;

  const StatusBadge.approval({
    super.key,
    required this.status,
  }) : type = StatusBadgeType.approval;

  Map<String, String> get _labels {
    switch (type) {
      case StatusBadgeType.task:
        return AppConstants.statusLabels;
      case StatusBadgeType.execution:
        return AppConstants.executionStatusLabels;
      case StatusBadgeType.approval:
        return AppConstants.approvalStatusLabels;
    }
  }

  Color get _color {
    switch (type) {
      case StatusBadgeType.task:
      case StatusBadgeType.approval:
        return ColorUtils.statusColor(status);
      case StatusBadgeType.execution:
        return ColorUtils.executionStatusColor(status);
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color;
    final label = _labels[status] ?? status;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
