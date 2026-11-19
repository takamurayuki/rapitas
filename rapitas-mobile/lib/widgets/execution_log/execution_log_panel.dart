/// 実行ログの表示本体：上に「いまの状態」1行、本体は出来事のタイムライン、
/// 「詳細」に切り替えると生ログ全件。実行画面とタスク詳細の両方がこの部品を使う。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/execution_provider.dart';
import '../../screens/rapi/rapi_jump_to_latest.dart' show rapiFollowsNew;
import '../../services/execution_log/execution_log_digest.dart';
import '../../services/execution_log/execution_log_snapshot.dart';
import 'execution_log_event_tile.dart';
import 'execution_log_raw_view.dart';
import 'execution_log_status_line.dart';

/// 実行ログのパネル
class ExecutionLogPanel extends ConsumerStatefulWidget {
  final String title;
  final String taskId;

  /// null ならタスクの最新セッション全体
  final String? executionId;

  /// ボトムシートの DraggableScrollableSheet から渡す（無ければ自前で持つ）
  final ScrollController? scrollController;
  final VoidCallback? onClose;

  const ExecutionLogPanel({
    super.key,
    required this.title,
    required this.taskId,
    this.executionId,
    this.scrollController,
    this.onClose,
  });

  @override
  ConsumerState<ExecutionLogPanel> createState() => _ExecutionLogPanelState();
}

class _ExecutionLogPanelState extends ConsumerState<ExecutionLogPanel> {
  ScrollController? _ownScroll;
  Timer? _poll;
  bool _showRaw = false;

  /// 末尾へ寄せる予約（開いた直後・自分で読み直した・表示を切り替えた直後）。
  /// 実際に末尾へ移動できた時点で外す。残すと、その後に遡って読んでいても次の新着で末尾へ飛ぶ
  bool _followNext = true;

  ScrollController get _scroll => widget.scrollController ?? (_ownScroll ??= ScrollController());

  ({String taskId, String? executionId}) get _key => (taskId: widget.taskId, executionId: widget.executionId);

  @override
  void initState() {
    super.initState();
    final interval = ref.read(executionLogPollIntervalProvider);
    if (interval != null) {
      _poll = Timer.periodic(interval, (_) {
        if (!mounted) return;
        final status = ref.read(taskExecutionLogsProvider(_key)).valueOrNull?.status;
        if (status == 'running' || status == 'waiting_for_input' || status == 'pending') {
          ref.invalidate(taskExecutionLogsProvider(_key));
        }
      });
    }
    // 取得済み（キャッシュあり）だと listen は呼ばれないので、開いた直後の末尾寄せはここでもする
    _scrollToEndAfterFrame();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _ownScroll?.dispose();
    super.dispose();
  }

  void _reload() {
    _followNext = true;
    ref.invalidate(taskExecutionLogsProvider(_key));
  }

  void _toggleRaw() {
    setState(() {
      _showRaw = !_showRaw;
      _followNext = true;
    });
    _scrollToEndAfterFrame();
  }

  void _scrollToEndAfterFrame() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
      // NOTE: 予約はここで消化する。まだ一覧が無い（読み込み中）ときは残し、データが届いたときに寄せる
      _followNext = false;
    });
  }

  /// NOTE: チャット画面（rapi_screen.dart）と同じ規則。自分の操作の直後と、末尾付近にいるときだけ
  /// 新着に追随する。遡って読んでいる間に読み直しが来ても位置は動かさない。
  /// 位置は新しい行を描く前のもの（届く前に末尾付近にいたか）で判断する。
  void _onData(AsyncValue<ExecutionLogSnapshot>? prev, AsyncValue<ExecutionLogSnapshot> next) {
    if (!next.hasValue) return;
    final grew = prev?.valueOrNull?.entries.length != next.value!.entries.length;
    final atEnd = !_scroll.hasClients || rapiFollowsNew(_scroll.position);
    if (_followNext || (grew && atEnd)) _scrollToEndAfterFrame();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(taskExecutionLogsProvider(_key), _onData);
    final async = ref.watch(taskExecutionLogsProvider(_key));
    final snapshot = async.valueOrNull;
    final digest = snapshot == null ? null : digestExecutionLog(snapshot);
    return Column(
      key: const ValueKey('exec-log-panel'),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 4, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '実行ログ：${widget.title}',
                  style: Theme.of(context).textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              FilterChip(
                key: const ValueKey('exec-log-raw-toggle'),
                label: const Text('詳細'),
                avatar: Icon(_showRaw ? Icons.notes : Icons.subject, size: 18),
                tooltip: _showRaw ? '出来事の表示に戻す' : '記録された生ログを全部見る',
                selected: _showRaw,
                showCheckmark: false,
                onSelected: (_) => _toggleRaw(),
              ),
              IconButton(icon: const Icon(Icons.refresh), tooltip: '再読み込み', onPressed: _reload),
              if (widget.onClose != null)
                IconButton(icon: const Icon(Icons.close), tooltip: '閉じる', onPressed: widget.onClose),
            ],
          ),
        ),
        if (digest != null) ExecutionLogStatusLine(state: digest.state),
        const SizedBox(height: 4),
        Expanded(
          child: async.when(
            data: (snapshot) => _showRaw
                ? ExecutionLogRawView(entries: snapshot.entries, scrollController: _scroll)
                : _Timeline(digest: digest!, scrollController: _scroll),
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Text('ログの取得に失敗しました: $e')),
          ),
        ),
      ],
    );
  }
}

class _Timeline extends StatelessWidget {
  final ExecLogDigest digest;
  final ScrollController scrollController;

  const _Timeline({required this.digest, required this.scrollController});

  @override
  Widget build(BuildContext context) {
    final events = digest.events;
    final hidden = digest.hiddenLines + digest.otherLines;
    if (events.isEmpty) {
      return Center(
        child: Text(hidden == 0 ? 'ログはまだありません' : 'まだ伝える出来事はありません（「詳細」で生ログを見られます）'),
      );
    }
    return ListView.builder(
      key: const ValueKey('exec-log-timeline'),
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(8, 4, 0, 24),
      itemCount: events.length + (hidden > 0 ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == events.length) {
          return Padding(
            key: const ValueKey('exec-log-hidden-note'),
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Text(
              '内部の記録 $hidden 行は表示していません（「詳細」で全文を見られます）',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
            ),
          );
        }
        return ExecutionLogEventTile(event: events[index], isLast: index == events.length - 1);
      },
    );
  }
}
