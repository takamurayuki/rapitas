import 'package:flutter/material.dart';

class ColorUtils {
  static Color statusColor(String status) {
    switch (status) {
      case 'todo':
        return Colors.grey;
      case 'in-progress':
        return Colors.blue;
      case 'done':
        return Colors.green;
      default:
        return Colors.grey;
    }
  }

  static Color priorityColor(String priority) {
    switch (priority) {
      case 'low':
        return Colors.green;
      case 'medium':
        return Colors.orange;
      case 'high':
        return Colors.deepOrange;
      case 'urgent':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  static Color executionStatusColor(String status) {
    switch (status) {
      case 'pending':
        return Colors.grey;
      case 'running':
        return Colors.blue;
      case 'completed':
        return Colors.green;
      case 'failed':
        return Colors.red;
      case 'cancelled':
        return Colors.orange;
      case 'interrupted':
        return Colors.amber;
      default:
        return Colors.grey;
    }
  }

  static Color? parseColor(String? hex) {
    if (hex == null || hex.isEmpty) return null;
    hex = hex.replaceFirst('#', '');
    if (hex.length == 6) hex = 'FF$hex';
    final value = int.tryParse(hex, radix: 16);
    return value != null ? Color(value) : null;
  }
}
