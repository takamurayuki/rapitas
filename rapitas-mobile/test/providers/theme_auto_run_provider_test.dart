import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/realtime_refresh_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_auto_run_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/services/sse_service.dart';

import '../support/theme_auto_run_fakes.dart';

/// SSE で一緒に読み直される一覧は通信しないように空で差し替える
final _quietExecutionLists = [
  executingTasksProvider.overrideWith((ref) async => const <ExecutingTask>[]),
  resumableExecutionsProvider.overrideWith((ref) async => const <ResumableExecution>[]),
];

class _FakeSse implements SseService {
  final controller = StreamController<SseEvent>.broadcast();

  @override
  Stream<SseEvent> get events => controller.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('開発テーマだけを自動実行の対象にする', () async {
    final container = ProviderContainer(overrides: [
      themeListProvider.overrideWith((ref) async => dummyThemes),
    ]);
    addTearDown(container.dispose);
    final sub = container.listen(developmentThemesProvider, (_, __) {});
    addTearDown(sub.close);

    final themes = await container.read(developmentThemesProvider.future);
    expect(themes.map((t) => t.id), ['1', '2']);
  });

  test('実行中一覧を読み直す SSE（auto_run_update / execution_status）で自動実行の状態も取り直す', () async {
    final sse = _FakeSse();
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1')});
    final container = ProviderContainer(overrides: [
      sseServiceProvider.overrideWithValue(sse),
      themeAutoRunServiceProvider.overrideWithValue(service),
      ..._quietExecutionLists,
    ]);
    addTearDown(container.dispose);
    container.read(realtimeRefreshProvider);
    final sub = container.listen(themeAutoRunProvider('1'), (_, __) {});
    addTearDown(sub.close);

    await container.read(themeAutoRunProvider('1').future);
    expect(service.fetched, ['1']);

    service.snapshots['1'] = runningSnapshot('1');
    sse.controller.add(SseEvent(type: 'auto_run_update', data: const {}));
    await Future<void>.delayed(const Duration(milliseconds: 500));
    final snapshot = await container.read(themeAutoRunProvider('1').future);

    expect(service.fetched, ['1', '1']);
    expect(snapshot.state.isRunning, isTrue);

    sse.controller.add(SseEvent(type: 'execution_status', data: const {}));
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await container.read(themeAutoRunProvider('1').future);
    expect(service.fetched, ['1', '1', '1']);
  });

  test('画面が watch をやめると状態を保持せず、以後の SSE でも取りに行かない', () async {
    final sse = _FakeSse();
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1')});
    final container = ProviderContainer(overrides: [
      sseServiceProvider.overrideWithValue(sse),
      themeAutoRunServiceProvider.overrideWithValue(service),
      ..._quietExecutionLists,
    ]);
    addTearDown(container.dispose);
    container.read(realtimeRefreshProvider);
    final sub = container.listen(themeAutoRunProvider('1'), (_, __) {});
    await container.read(themeAutoRunProvider('1').future);
    sub.close();
    await Future<void>.delayed(Duration.zero);

    sse.controller.add(SseEvent(type: 'auto_run_update', data: const {}));
    await Future<void>.delayed(const Duration(milliseconds: 500));

    expect(service.fetched, ['1']);
    expect(container.exists(themeAutoRunProvider('1')), isFalse);
  });
}
