/// 出来事のタイムラインの1行（種類のアイコン＋見出し＋時刻、長い文は先頭だけ出してタップで全文）。
library;

import 'package:flutter/material.dart';

import '../../services/execution_log/execution_log_digest.dart';
import 'execution_log_style.dart';

/// 畳んでいるときに見せる本文の行数
const execLogPreviewLines = 3;

/// 出来事1件
class ExecutionLogEventTile extends StatefulWidget {
  final ExecLogEvent event;

  /// 最後の出来事か（縦線を下へ伸ばさない）
  final bool isLast;

  const ExecutionLogEventTile({super.key, required this.event, this.isLast = false});

  @override
  State<ExecutionLogEventTile> createState() => _ExecutionLogEventTileState();
}

class _ExecutionLogEventTileState extends State<ExecutionLogEventTile> {
  bool _expanded = false;

  ExecLogEvent get _e => widget.event;

  String get _heading => switch (_e.kind) {
        ExecLogKind.start => _e.title,
        ExecLogKind.speech => 'エージェント',
        ExecLogKind.question => '質問',
        ExecLogKind.warning => '注意',
        _ => _e.title,
      };

  /// 本文（作業は項目の並び、それ以外は記録された文）
  String? get _body {
    if (_e.kind == ExecLogKind.work) {
      final lines = [..._e.items, if (_e.detail != null) _e.detail!];
      return lines.isEmpty ? null : lines.join('\n');
    }
    if (_e.kind == ExecLogKind.milestone && _e.body == _e.title) return null;
    return _e.body;
  }

  String? get _badge {
    if (_e.kind == ExecLogKind.work) return _e.failures > 0 ? 'うち失敗 ${_e.failures}' : null;
    if (_e.count <= 1) return null;
    return _e.title == 'エラー出力' ? '${_e.count}行' : '×${_e.count}';
  }

  @override
  Widget build(BuildContext context) {
    final style = execLogKindStyle(context, _e.kind);
    final theme = Theme.of(context);
    final body = _body;
    // NOTE: 質問は必ず全文を見せる（畳まない）。作業は既定で畳み、件数の見出しだけにする
    final foldable = body != null && _e.kind != ExecLogKind.question;
    final long = foldable && (_e.kind == ExecLogKind.work || _isLong(body));
    final showBody = body != null && (_e.kind != ExecLogKind.work || _expanded);
    final clock = execLogClock(_e.time);
    final until = _e.count > 1 && _e.lastTime != _e.time ? '〜${execLogClock(_e.lastTime)}' : '';

    return InkWell(
      key: ValueKey('exec-log-event-${_e.kind.name}'),
      onTap: long ? () => setState(() => _expanded = !_expanded) : null,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 36,
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  Icon(style.icon, size: 20, color: style.color),
                  if (!widget.isLast)
                    Expanded(child: Container(width: 1.5, color: theme.dividerColor)),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 8, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _heading,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleSmall?.copyWith(
                              color: _e.kind == ExecLogKind.speech ? null : style.color,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (_badge != null) _Badge(text: _badge!, color: style.color),
                        const SizedBox(width: 6),
                        Text('$clock$until', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                      ],
                    ),
                    if (showBody) ...[
                      const SizedBox(height: 4),
                      Text(
                        body,
                        key: ValueKey('exec-log-event-body-${_e.kind.name}'),
                        maxLines: long && !_expanded ? execLogPreviewLines : null,
                        overflow: long && !_expanded ? TextOverflow.ellipsis : null,
                        style: _e.kind == ExecLogKind.work || _e.title == 'エラー出力'
                            ? theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace')
                            : theme.textTheme.bodyMedium,
                      ),
                    ],
                    if (long)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          _expanded ? 'たたむ' : (_e.kind == ExecLogKind.work ? 'タップで内訳を見る' : 'タップで全文を見る'),
                          style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.primary),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static bool _isLong(String text) => text.split('\n').length > execLogPreviewLines || text.length > 120;
}

class _Badge extends StatelessWidget {
  final String text;
  final Color color;

  const _Badge({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color)),
    );
  }
}
