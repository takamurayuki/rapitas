import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import '../models/theme_auto_run.dart';
import '../services/theme_auto_run_service.dart';
import 'service_providers.dart';
import 'theme_data_provider.dart';

final themeAutoRunServiceProvider = Provider<ThemeAutoRunService>((ref) {
  return ThemeAutoRunService(ref.watch(apiClientProvider));
});

/// 自動実行の対象になりうるテーマ＝開発テーマ（Theme.isDevelopment）だけ。並びは GET /themes のまま
final developmentThemesProvider = FutureProvider.autoDispose<List<TaskTheme>>((ref) async {
  final themes = await ref.watch(themeListProvider.future);
  return themes.where((t) => t.isDevelopment).toList();
});

/// テーマごとの自動実行の状態（GET /themes/:id/auto-run）。
///
/// NOTE: 定期タイマーは持たない。実行中タスク一覧（executingTasksProvider）と同じく、
/// SSE の execution_status / auto_run_update で realtimeRefreshProvider が読み直す。
/// autoDispose なので、実行画面を離れれば watch が外れて保持も止まる。
final themeAutoRunProvider =
    FutureProvider.autoDispose.family<ThemeAutoRunSnapshot, String>((ref, themeId) async {
  final service = ref.watch(themeAutoRunServiceProvider);
  return service.getAutoRun(themeId);
});
