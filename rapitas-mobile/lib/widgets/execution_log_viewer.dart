import 'package:flutter/material.dart';

class ExecutionLogViewer extends StatelessWidget {
  final List<dynamic> logs;
  final ScrollController? scrollController;

  const ExecutionLogViewer({
    super.key,
    required this.logs,
    this.scrollController,
  });

  @override
  Widget build(BuildContext context) {
    if (logs.isEmpty) {
      return const Center(
        child: Text('ログはまだありません'),
      );
    }

    return ListView.builder(
      controller: scrollController,
      itemCount: logs.length,
      padding: const EdgeInsets.all(8),
      itemBuilder: (context, index) {
        final log = logs[index];
        final message = log is Map ? (log['message'] ?? log.toString()) : log.toString();
        final level = log is Map ? (log['level'] ?? 'info') : 'info';
        final timestamp = log is Map ? log['timestamp'] : null;

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 1),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (timestamp != null)
                Text(
                  '${DateTime.tryParse(timestamp.toString())?.toLocal().toString().substring(11, 19) ?? ''} ',
                  style: TextStyle(
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
                  ),
                ),
              Icon(
                _levelIcon(level.toString()),
                size: 14,
                color: _levelColor(level.toString()),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  message.toString(),
                  style: TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: _levelColor(level.toString()),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  IconData _levelIcon(String level) {
    switch (level) {
      case 'error':
        return Icons.error_outline;
      case 'warn':
      case 'warning':
        return Icons.warning_amber;
      case 'info':
        return Icons.info_outline;
      default:
        return Icons.circle;
    }
  }

  Color _levelColor(String level) {
    switch (level) {
      case 'error':
        return Colors.red;
      case 'warn':
      case 'warning':
        return Colors.orange;
      case 'info':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }
}
