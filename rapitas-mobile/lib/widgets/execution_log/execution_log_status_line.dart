/// 実行ログの上部に出す「いまの状態」1行（実行中／入力待ち／エラー／完了 など＋短い説明）。
library;

import 'package:flutter/material.dart';

import '../../services/execution_log/execution_log_digest.dart';
import 'execution_log_style.dart';

/// 状態の帯
class ExecutionLogStatusLine extends StatelessWidget {
  final ExecLogState state;

  const ExecutionLogStatusLine({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    final style = execLogPhaseStyle(context, state.phase);
    final text = Theme.of(context).textTheme;
    return Container(
      key: const ValueKey('exec-log-status'),
      margin: const EdgeInsets.symmetric(horizontal: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: style.color.withValues(alpha: 0.10),
        border: Border.all(color: style.color.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(style.icon, color: style.color, size: 20),
          const SizedBox(width: 8),
          Text(state.label, style: text.titleSmall?.copyWith(color: style.color, fontWeight: FontWeight.bold)),
          if (state.description != null) ...[
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                state.description!.trim().split('\n').first,
                key: const ValueKey('exec-log-status-description'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: text.bodyMedium,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
