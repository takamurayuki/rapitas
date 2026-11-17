import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/models/theme_auto_run.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_auto_run_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/services/theme_auto_run_service.dart';

// 実行画面の自動実行セクションのテストと確認画像で共有するダミー。

/// 状態は [snapshots] から返し、操作は [calls] に `start:<id>:<order>` / `pause:<id>` / `stop:<id>` で控える。
/// [failWith] があれば次の操作をその文面の ThemeAutoRunException で失敗させる（400 の理由の代わり）。
/// [gate] があれば操作はその完了まで待つ（操作待機中＝カードの busy を作るため）
class FakeThemeAutoRunService implements ThemeAutoRunService {
  final Map<String, ThemeAutoRunSnapshot> snapshots;
  final List<String> calls = [];
  final List<String> fetched = [];
  String? failWith;
  Completer<void>? gate;

  FakeThemeAutoRunService(Map<String, ThemeAutoRunSnapshot> initial) : snapshots = {...initial};

  @override
  Future<ThemeAutoRunSnapshot> getAutoRun(String themeId) async {
    fetched.add(themeId);
    return snapshots[themeId] ?? idleSnapshot(themeId);
  }

  Future<void> _act(String call) async {
    final pending = gate;
    if (pending != null) await pending.future;
    final failure = failWith;
    if (failure != null) {
      failWith = null;
      throw ThemeAutoRunException(failure);
    }
    calls.add(call);
  }

  @override
  Future<void> start(String themeId, {String order = 'priority'}) async => _act('start:$themeId:$order');

  @override
  Future<void> pause(String themeId) async => _act('pause:$themeId');

  @override
  Future<void> stop(String themeId) async => _act('stop:$themeId');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final dummyThemes = [
  TaskTheme(id: '1', name: '【ダミー】rapitas 開発', color: '#3B82F6', isDevelopment: true, workingDirectory: '/work/rapitas'),
  TaskTheme(id: '2', name: '【ダミー】モバイル版', color: '#10B981', isDevelopment: true, workingDirectory: '/work/mobile'),
  TaskTheme(id: '3', name: '【ダミー】買い物メモ', color: '#F59E0B'),
];

final noFolderTheme = TaskTheme(id: '4', name: '【ダミー】フォルダ未設定', color: '#8B5CF6', isDevelopment: true);

ThemeAutoRunSnapshot idleSnapshot(String themeId, {String? lastError}) => ThemeAutoRunSnapshot(
      state: ThemeAutoRunState(themeId: themeId, processedCount: 0, lastError: lastError),
      remainingCount: 4,
    );

ThemeAutoRunSnapshot runningSnapshot(String themeId, {bool withTitle = true}) => ThemeAutoRunSnapshot(
      state: ThemeAutoRunState(
        themeId: themeId,
        enabled: true,
        status: 'running',
        currentTaskId: '812',
        processedCount: 3,
      ),
      currentTaskTitle: withTitle ? '【ダミー】ログイン画面のエラー表示を直す' : null,
      remainingCount: 5,
    );

ThemeAutoRunSnapshot pausedSnapshot(String themeId) => ThemeAutoRunSnapshot(
      state: ThemeAutoRunState(
        themeId: themeId,
        enabled: true,
        status: 'paused',
        pauseReason: 'awaiting_approval',
        currentTaskId: '812',
        processedCount: 3,
      ),
      currentTaskTitle: '【ダミー】ログイン画面のエラー表示を直す',
      remainingCount: 5,
    );

/// 実行画面を通信なしで出すための差し替え一式（実行中・再開可能は空）
List<Override> autoRunScreenOverrides(FakeThemeAutoRunService service, List<TaskTheme> themes) => [
      themeAutoRunServiceProvider.overrideWithValue(service),
      themeListProvider.overrideWith((ref) async => themes),
      executingTasksProvider.overrideWith((ref) async => const <ExecutingTask>[]),
      resumableExecutionsProvider.overrideWith((ref) async => const <ResumableExecution>[]),
      taskTitleLookupProvider.overrideWithValue(const {}),
      taskListProvider.overrideWith((ref, filter) async => const <Task>[]),
    ];
