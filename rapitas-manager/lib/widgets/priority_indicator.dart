import 'package:flutter/material.dart';
import '../utils/color_utils.dart';
import '../utils/constants.dart';

class PriorityIndicator extends StatelessWidget {
  final String priority;

  const PriorityIndicator({super.key, required this.priority});

  IconData get _icon {
    switch (priority) {
      case 'urgent':
        return Icons.keyboard_double_arrow_up;
      case 'high':
        return Icons.keyboard_arrow_up;
      case 'medium':
        return Icons.remove;
      case 'low':
        return Icons.keyboard_arrow_down;
      default:
        return Icons.remove;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = ColorUtils.priorityColor(priority);
    final label = AppConstants.priorityLabels[priority] ?? priority;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(_icon, color: color, size: 18),
        const SizedBox(width: 2),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
