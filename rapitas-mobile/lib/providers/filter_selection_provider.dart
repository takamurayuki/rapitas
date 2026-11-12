import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/task.dart';
import '../services/filter_selection.dart';
import 'backlog_provider.dart';
import 'service_providers.dart';
import 'task_provider.dart';
import 'theme_data_provider.dart';

// タスク一覧・アイデア一覧のテーマの初期選択（filter_selection.dart の解決）を、
// テーマ一覧の取得完了時に一度だけ絞り込み条件へ入れるためのプロバイダー群。

/// ☆ カテゴリ（UserSettings.defaultCategoryId）。取得できなければ null（☆ なしとして扱う）
final defaultCategoryIdProvider = FutureProvider<String?>((ref) async {
  try {
    return await ref.watch(categoryServiceProvider).getDefaultCategoryId();
  } catch (_) {
    return null;
  }
});

/// カテゴリ一覧（並び順用）。取得失敗はテーマに埋め込まれたカテゴリで代用するので null
Future<List<TaskCategory>?> _categoriesOrNull(Ref ref) async {
  try {
    return await ref.watch(categoryListProvider.future);
  } catch (_) {
    return null;
  }
}

/// テーマ一覧。取得失敗は「テーマなし」と同じく初期選択をしない
Future<List<TaskTheme>> _themesOrEmpty(Ref ref) async {
  try {
    return await ref.watch(themeListProvider.future);
  } catch (_) {
    return const [];
  }
}

/// タスク一覧の初期選択。カテゴリに属するテーマが無ければ null
final taskInitialSelectionProvider = FutureProvider<TaskSelection?>((ref) async {
  final themes = await _themesOrEmpty(ref);
  if (themes.isEmpty) return null;
  return resolveTaskSelection(
    themes: themes,
    categories: await _categoriesOrNull(ref),
    defaultCategoryId: await ref.watch(defaultCategoryIdProvider.future),
    memory: await FilterSelectionStore.loadTask(),
  );
});

/// アイデア一覧の初期選択（テーマID または [ideaNoThemeId]）。テーマが無ければ null
final ideaInitialSelectionProvider = FutureProvider<String?>((ref) async {
  final themes = await _themesOrEmpty(ref);
  if (themes.isEmpty) return null;
  return resolveIdeaSelection(
    themes: themes,
    categories: await _categoriesOrNull(ref),
    defaultCategoryId: await ref.watch(defaultCategoryIdProvider.future),
    memory: await FilterSelectionStore.loadIdea(),
  );
});

/// タスク一覧の初期選択を適用済みか（アプリの起動中に一度だけ。以後はユーザの選択を優先する）
final taskSelectionAppliedProvider = StateProvider<bool>((ref) => false);

/// アイデア一覧の初期選択を適用済みか
final ideaSelectionAppliedProvider = StateProvider<bool>((ref) => false);

/// 解決結果が届いていれば、タスク一覧の絞り込みへ一度だけ入れる。
///
/// すでにテーマが指定されている（テーマ画面・音声から来た）ときはそれを優先し、上書きしない。
///
/// @param read - プロバイダーの読み取り（WidgetRef.read / ProviderContainer.read）
/// @param selection - taskInitialSelectionProvider の現在値
void applyInitialTaskSelection(
  T Function<T>(ProviderListenable<T>) read,
  AsyncValue<TaskSelection?> selection,
) {
  if (read(taskSelectionAppliedProvider)) return;
  if (selection.isLoading && !selection.hasValue) return;
  read(taskSelectionAppliedProvider.notifier).state = true;
  final themeId = selection.valueOrNull?.themeId;
  final filter = read(taskFilterProvider);
  if (themeId != null && filter.themeId == null) {
    read(taskFilterProvider.notifier).state = filter.copyWith(themeId: themeId);
  }
}

/// 解決結果が届いていれば、アイデア一覧の絞り込みへ一度だけ入れる（既に指定があれば上書きしない）
///
/// @param read - プロバイダーの読み取り
/// @param selection - ideaInitialSelectionProvider の現在値
void applyInitialIdeaSelection(
  T Function<T>(ProviderListenable<T>) read,
  AsyncValue<String?> selection,
) {
  if (read(ideaSelectionAppliedProvider)) return;
  if (selection.isLoading && !selection.hasValue) return;
  read(ideaSelectionAppliedProvider.notifier).state = true;
  final themeId = selection.valueOrNull;
  final filter = read(ideaFilterProvider);
  if (themeId != null && filter.themeId == null) {
    read(ideaFilterProvider.notifier).state = filter.copyWith(themeId: themeId);
  }
}

/// タスク一覧でテーマを選んだことを記憶する（カテゴリなしのテーマは候補外なので記憶しない）
Future<void> rememberTaskTheme(TaskTheme theme) async {
  final categoryId = theme.categoryId;
  if (categoryId == null) return;
  await FilterSelectionStore.rememberTaskTheme(categoryId: categoryId, themeId: theme.id);
}
