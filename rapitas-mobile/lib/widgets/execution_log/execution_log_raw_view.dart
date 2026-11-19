/// 実行ログの「詳細」：記録された chunk を加工せず全件並べる（情報を失わないための表示）。
library;

import 'package:flutter/material.dart';

import '../../services/execution_log/execution_log_snapshot.dart';
import 'execution_log_style.dart';

/// 生ログの一覧
class ExecutionLogRawView extends StatelessWidget {
  final List<ExecutionLogEntry> entries;
  final ScrollController? scrollController;

  const ExecutionLogRawView({super.key, required this.entries, this.scrollController});

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const Center(child: Text('ログはまだありません'));
    final theme = Theme.of(context);
    final mono = theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace', fontSize: 12);
    return ListView.builder(
      key: const ValueKey('exec-log-raw'),
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
      itemCount: entries.length,
      itemBuilder: (context, index) {
        final entry = entries[index];
        final color = entry.isStderr ? theme.colorScheme.error : theme.colorScheme.onSurface;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 64,
                child: Text(execLogClock(entry.timestamp), style: mono?.copyWith(color: theme.colorScheme.outline)),
              ),
              if (entry.isStderr)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Text('stderr', style: mono?.copyWith(color: color, fontWeight: FontWeight.bold)),
                ),
              Expanded(
                child: SelectableText(entry.chunk.trimRight(), style: mono?.copyWith(color: color)),
              ),
            ],
          ),
        );
      },
    );
  }
}
