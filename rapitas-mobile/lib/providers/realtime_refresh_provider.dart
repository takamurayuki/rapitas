import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'approval_provider.dart';
import 'execution_provider.dart';
import 'notification_provider.dart';
import 'service_providers.dart';
import 'task_provider.dart';

/// SSE のイベント名と、それを受けたら読み直す一覧の対応。
///
/// NOTE: イベント名は rapitas-backend の realtime-service.ts が実際に送っているもの。
/// CLAUDE.md の「SSE Event Types」(execution-update など) は実装と一致していない。
/// 承認待ちは専用イベントが無く、通知（new_notification）とワークフローの
/// フェーズ遷移（phase_transition）で知るため、両方で承認一覧を読み直す。
enum RefreshTarget { tasks, executions, notifications, approvals }

const Map<String, Set<RefreshTarget>> refreshTargetsByEvent = {
  'task_created': {RefreshTarget.tasks},
  'task_updated': {RefreshTarget.tasks},
  'task_completed': {RefreshTarget.tasks},
  'subtasks_created': {RefreshTarget.tasks},
  'execution_status': {RefreshTarget.executions, RefreshTarget.tasks},
  'new_notification': {RefreshTarget.notifications, RefreshTarget.approvals},
  'phase_transition': {RefreshTarget.tasks, RefreshTarget.approvals},
  'auto_run_update': {RefreshTarget.tasks, RefreshTarget.executions},
};

/// アプリ起動中ずっと SSE を購読し、届いたイベントに応じて一覧を読み直す。
/// app.dart で watch して常駐させる。
final realtimeRefreshProvider = Provider<void>((ref) {
  final service = ref.watch(sseServiceProvider);
  final pending = <RefreshTarget>{};
  Timer? debounce;

  void flush() {
    for (final target in pending) {
      switch (target) {
        case RefreshTarget.tasks:
          ref.invalidate(taskListProvider);
          ref.invalidate(taskDetailProvider);
        case RefreshTarget.executions:
          ref.invalidate(executionListProvider);
          ref.invalidate(executionDetailProvider);
        case RefreshTarget.notifications:
          ref.invalidate(notificationListProvider);
        case RefreshTarget.approvals:
          ref.invalidate(approvalListProvider);
      }
    }
    pending.clear();
  }

  final subscription = service.events.listen((event) {
    final targets = refreshTargetsByEvent[event.type];
    if (targets == null) return;
    pending.addAll(targets);
    // 実行中はイベントが連続して届くので、まとめて1回だけ読み直す
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 400), flush);
  });

  ref.onDispose(() {
    debounce?.cancel();
    subscription.cancel();
  });
});
