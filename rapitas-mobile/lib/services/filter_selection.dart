import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/task.dart';

// タスク一覧・アイデア一覧のテーマ選択の初期値（記憶 → ☆ → 並び順の先頭）の解決と、選択の記憶。
//
// 「すべて」を無くし、常にどれか1つのテーマ（アイデアは「指定なし」も可）が選ばれた状態にするための部品。
// 画面・プロバイダーには依存しない（解決は純粋関数、記憶は SharedPreferences）。

/// アイデアの「指定なし」（テーマ未定のアイデアだけ）を表す値。
/// GET /idea-box の themeId にもこのまま送る（バックエンドは 'none' を themeId IS NULL と解釈する）
const String ideaNoThemeId = 'none';

/// タスク一覧の選択の記憶（最後に選んだカテゴリと、カテゴリごとに最後に選んだテーマ）
class TaskSelectionMemory {
  final String? lastCategoryId;

  /// カテゴリID → そのカテゴリで最後に選んだテーマID
  final Map<String, String> themeByCategory;

  const TaskSelectionMemory({this.lastCategoryId, this.themeByCategory = const {}});
}

/// タスク一覧の選択（カテゴリとテーマ）
class TaskSelection {
  final String categoryId;
  final String themeId;

  const TaskSelection({required this.categoryId, required this.themeId});
}

/// テーマを持つカテゴリの ID を並び順（sortOrder 昇順 → 数値 id 昇順）で返す。
///
/// categoryId が null のテーマ（カテゴリ削除時だけ生じる例外状態）は候補にしない。
/// [categories]（GET /categories）があればその sortOrder を、無ければテーマに埋め込まれたカテゴリの値を使う。
///
/// @param themes - テーマ一覧（GET /themes の並び）
/// @param categories - カテゴリ一覧。取れていなければ null
/// @returns 候補カテゴリの ID 一覧
List<String> orderedCategoryIds(List<TaskTheme> themes, List<TaskCategory>? categories) {
  final sortOrders = <String, int?>{};
  for (final theme in themes) {
    final id = theme.categoryId;
    if (id == null) continue;
    sortOrders.putIfAbsent(id, () => theme.category?.sortOrder);
  }
  for (final category in categories ?? const <TaskCategory>[]) {
    if (sortOrders.containsKey(category.id)) sortOrders[category.id] = category.sortOrder;
  }
  final ids = sortOrders.keys.toList();
  ids.sort((a, b) {
    final sa = sortOrders[a];
    final sb = sortOrders[b];
    if (sa != null && sb != null && sa != sb) return sa.compareTo(sb);
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    final ia = int.tryParse(a);
    final ib = int.tryParse(b);
    if (ia != null && ib != null) return ia.compareTo(ib);
    return a.compareTo(b);
  });
  return ids;
}

/// カテゴリに属するテーマ（GET /themes の並び＝バックエンドの sortOrder 順を保つ）
List<TaskTheme> themesOfCategory(List<TaskTheme> themes, String categoryId) =>
    [for (final t in themes) if (t.categoryId == categoryId) t];

/// カテゴリ内の ☆ テーマ、無ければ先頭テーマの ID。テーマが無ければ null
String? _starOrFirst(List<TaskTheme> inCategory) {
  if (inCategory.isEmpty) return null;
  for (final t in inCategory) {
    if (t.isDefault) return t.id;
  }
  return inCategory.first.id;
}

/// カテゴリを切り替えたときのテーマ：そのカテゴリでの記憶 → ☆ テーマ → 先頭テーマ。
///
/// @param categoryId - 切り替え先のカテゴリID
/// @param themes - テーマ一覧
/// @param memory - タスク一覧の選択の記憶
/// @returns テーマID。カテゴリにテーマが無ければ null
String? resolveThemeForCategory({
  required String categoryId,
  required List<TaskTheme> themes,
  required TaskSelectionMemory memory,
}) {
  final inCategory = themesOfCategory(themes, categoryId);
  final remembered = memory.themeByCategory[categoryId];
  if (remembered != null && inCategory.any((t) => t.id == remembered)) return remembered;
  return _starOrFirst(inCategory);
}

/// タスク一覧の初期選択。
///
/// 1. 最後のカテゴリ＋そのカテゴリで最後に選んだテーマの記憶（どちらも一覧にあるときだけ）
/// 2. ☆ カテゴリ＋その ☆ テーマ（☆ テーマが無ければ先頭テーマ）
/// 3. 並び順先頭のカテゴリ＋その ☆ テーマ（無ければ先頭テーマ）
///
/// @param themes - テーマ一覧
/// @param categories - カテゴリ一覧（並び順用）。取れていなければ null
/// @param defaultCategoryId - ☆ カテゴリ（UserSettings.defaultCategoryId）。未設定なら null
/// @param memory - タスク一覧の選択の記憶
/// @returns 選択。カテゴリに属するテーマが1件も無ければ null（フィルターを適用しない）
TaskSelection? resolveTaskSelection({
  required List<TaskTheme> themes,
  required List<TaskCategory>? categories,
  required String? defaultCategoryId,
  required TaskSelectionMemory memory,
}) {
  final candidates = orderedCategoryIds(themes, categories);
  if (candidates.isEmpty) return null;

  final last = memory.lastCategoryId;
  if (last != null && candidates.contains(last)) {
    final remembered = memory.themeByCategory[last];
    if (remembered != null && themesOfCategory(themes, last).any((t) => t.id == remembered)) {
      return TaskSelection(categoryId: last, themeId: remembered);
    }
  }

  final categoryId = defaultCategoryId != null && candidates.contains(defaultCategoryId)
      ? defaultCategoryId
      : candidates.first;
  final themeId = _starOrFirst(themesOfCategory(themes, categoryId));
  return themeId == null ? null : TaskSelection(categoryId: categoryId, themeId: themeId);
}

/// アイデア一覧（とアイデア作成フォーム）の初期選択。
///
/// 1. 記憶（テーマID、または「指定なし」= [ideaNoThemeId]）。記憶したテーマが一覧に無ければ次へ
/// 2. ☆ カテゴリの ☆ テーマ
/// 3. いずれかの ☆ テーマ（カテゴリの並び順で最初のもの）
/// 4. 先頭テーマ（カテゴリの並び順。カテゴリなしのテーマはその後ろ）
///
/// @param themes - テーマ一覧
/// @param categories - カテゴリ一覧（並び順用）。取れていなければ null
/// @param defaultCategoryId - ☆ カテゴリ。未設定なら null
/// @param memory - 記憶したテーマID または [ideaNoThemeId]。記憶なしは null
/// @returns テーマID または [ideaNoThemeId]。テーマが1件も無ければ null（絞り込まない）
String? resolveIdeaSelection({
  required List<TaskTheme> themes,
  required List<TaskCategory>? categories,
  required String? defaultCategoryId,
  required String? memory,
}) {
  if (themes.isEmpty) return null;
  if (memory == ideaNoThemeId) return ideaNoThemeId;
  if (memory != null && themes.any((t) => t.id == memory)) return memory;

  final ordered = [
    for (final id in orderedCategoryIds(themes, categories)) ...themesOfCategory(themes, id),
    for (final t in themes) if (t.categoryId == null) t,
  ];
  if (defaultCategoryId != null) {
    for (final t in ordered) {
      if (t.categoryId == defaultCategoryId && t.isDefault) return t.id;
    }
  }
  for (final t in ordered) {
    if (t.isDefault) return t.id;
  }
  return ordered.first.id;
}

/// テーマ選択の記憶（SharedPreferences）。ID はすべて文字列で保存する。
///
/// 保存先が使えない・応答しない・値が壊れているときは「記憶なし」として扱い、例外は投げない
/// （記憶は初期選択の手がかりにすぎず、無くても ☆・先頭で選べるため）。
class FilterSelectionStore {
  static const String lastCategoryKey = 'filterSelection.task.lastCategoryId';
  static const String themeByCategoryKey = 'filterSelection.task.themeByCategory';
  static const String ideaThemeKey = 'filterSelection.idea.themeId';

  /// 記憶の読み込みを待つ上限。一覧の表示は初期選択の解決を待つので、保存先が応答しなくても止めない
  static const Duration loadTimeout = Duration(seconds: 2);

  /// タスク一覧の記憶を読む
  static Future<TaskSelectionMemory> loadTask() async {
    try {
      final prefs = await SharedPreferences.getInstance().timeout(loadTimeout);
      return TaskSelectionMemory(
        lastCategoryId: prefs.getString(lastCategoryKey),
        themeByCategory: _decodeMap(prefs.getString(themeByCategoryKey)),
      );
    } catch (_) {
      return const TaskSelectionMemory();
    }
  }

  /// タスク一覧でテーマを選んだことを記憶する（最後のカテゴリ＋カテゴリ別テーマ）
  ///
  /// @param categoryId - 選んだテーマのカテゴリID
  /// @param themeId - 選んだテーマID
  static Future<void> rememberTaskTheme({required String categoryId, required String themeId}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final map = _decodeMap(prefs.getString(themeByCategoryKey))..[categoryId] = themeId;
      await prefs.setString(lastCategoryKey, categoryId);
      await prefs.setString(themeByCategoryKey, jsonEncode(map));
    } catch (_) {
      // 記憶できなくても、この起動中は選んだテーマで動く
    }
  }

  /// アイデア一覧の記憶（テーマID または [ideaNoThemeId]）を読む。記憶なしは null
  static Future<String?> loadIdea() async {
    try {
      final prefs = await SharedPreferences.getInstance().timeout(loadTimeout);
      return prefs.getString(ideaThemeKey);
    } catch (_) {
      return null;
    }
  }

  /// アイデア一覧で選んだテーマ（または [ideaNoThemeId]）を記憶する
  static Future<void> rememberIdeaTheme(String themeIdOrNone) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(ideaThemeKey, themeIdOrNone);
    } catch (_) {
      // 記憶できなくても、この起動中は選んだテーマで動く
    }
  }

  static Map<String, String> _decodeMap(String? raw) {
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return {};
      return {
        for (final e in decoded.entries)
          if (e.value != null) e.key.toString(): e.value.toString(),
      };
    } on FormatException {
      return {};
    }
  }
}
