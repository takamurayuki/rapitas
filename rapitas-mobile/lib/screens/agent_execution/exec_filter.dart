import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';
import '../../providers/task_provider.dart';

// 実行画面の絞り込み条件と、その適用（表示だけの絞り込み）。
// 自動実行の動作・状態には触れない。音声操作（voice_command_flow）も同じ関数で
// 表示中の一覧を作り、「2番目を停止」の番号が画面と一致するようにしている。

/// 並び順。実行中は startedAt（無ければ sessionStartedAt）、再開可能は startedAt（無ければ createdAt）
enum ExecSort { newest, oldest }

/// 実行中リストの状態の絞り込み（再開可能は全て中断済みなので対象外）
enum ExecStatusFilter { all, running, waitingForInput }

/// 実行画面の絞り込み条件。既定値は「絞り込みなし・新しい順」
class ExecFilter {
  /// タスク名（自動実行カードはテーマ名）の部分一致。空なら絞らない
  final String query;

  /// 選択中のテーマIDの集合。空は「すべて」（nav71 で単一の themeId から複数選択に変えた）
  final Set<String> themeIds;
  final ExecSort sort;
  final ExecStatusFilter status;

  const ExecFilter({
    this.query = '',
    this.themeIds = const {},
    this.sort = ExecSort.newest,
    this.status = ExecStatusFilter.all,
  });

  bool get hasQuery => query.trim().isNotEmpty;

  /// テーマで絞っているか（集合が非空）
  bool get hasThemes => themeIds.isNotEmpty;

  /// テーマ条件に合うか。集合が空なら常に true、テーマ不明（null）は絞り込み中なら外す
  ///
  /// @param themeId - theme of the item, null when unknown / 対象のテーマID（不明なら null）
  /// @returns true when the item passes the theme condition / テーマ条件を満たすなら true
  bool matchesTheme(String? themeId) => themeIds.isEmpty || (themeId != null && themeIds.contains(themeId));

  /// テーマの選択を切り替える（含まれていれば外し、無ければ足す）
  ///
  /// @param themeId - theme to toggle / 切り替えるテーマID
  /// @returns the new conditions / 切り替え後の条件
  ExecFilter toggleTheme(String themeId) {
    final next = {...themeIds};
    if (!next.remove(themeId)) next.add(themeId);
    return copyWith(themeIds: next);
  }

  /// 実行中リストを絞る条件があるか（並び順は件数を変えないので含めない）
  bool get filtersExecuting => hasQuery || hasThemes || status != ExecStatusFilter.all;

  /// 再開可能・自動実行を絞る条件があるか（状態は対象外）
  bool get filtersOthers => hasQuery || hasThemes;

  /// 既定から変わっているか（クリア操作を出す目安。並び順の変更も含む）
  bool get isDefault =>
      !hasQuery && !hasThemes && sort == ExecSort.newest && status == ExecStatusFilter.all;

  ExecFilter copyWith({
    String? query,
    Set<String>? themeIds,
    ExecSort? sort,
    ExecStatusFilter? status,
  }) {
    return ExecFilter(
      query: query ?? this.query,
      themeIds: themeIds ?? this.themeIds,
      sort: sort ?? this.sort,
      status: status ?? this.status,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ExecFilter &&
      other.query == query &&
      _sameSet(other.themeIds, themeIds) &&
      other.sort == sort &&
      other.status == status;

  @override
  int get hashCode => Object.hash(query, Object.hashAllUnordered(themeIds), sort, status);

  static bool _sameSet(Set<String> a, Set<String> b) => a.length == b.length && a.containsAll(b);
}

/// taskId → テーマID と taskId → タスク名の突合表
class ExecLookups {
  final Map<String, String> titles;

  /// サブタスクは自身の themeId が無ければ親のテーマで引けるよう、解決済みの値を入れる
  final Map<String, String> themes;

  const ExecLookups({this.titles = const {}, this.themes = const {}});
}

/// タスク一覧（入れ子のサブタスクも含む）から taskId → テーマID を作る。
/// サブタスクに themeId が無ければ親のテーマを継ぐ
Map<String, String> buildTaskThemeLookup(List<Task>? tasks) {
  final themes = <String, String>{};
  void add(List<Task>? list, String? inherited) {
    if (list == null) return;
    for (final task in list) {
      final themeId = task.themeId ?? inherited;
      if (themeId != null) themes[task.id] = themeId;
      add(task.subtasks, themeId);
    }
  }

  add(tasks, null);
  return themes;
}

bool _matchesQuery(String text, String query) {
  final q = query.trim().toLowerCase();
  return q.isEmpty || text.toLowerCase().contains(q);
}

String? _themeOf(ExecLookups lookups, String? taskId, {String? parentId}) {
  if (taskId == null) return null;
  return lookups.themes[taskId] ?? (parentId == null ? null : lookups.themes[parentId]);
}

/// 日時で並べる。日時の無いものは並び順にかかわらず末尾（元の順を保つ安定ソート）
List<T> _sortByTime<T>(List<T> items, DateTime? Function(T) timeOf, ExecSort sort) {
  final indexed = [for (var i = 0; i < items.length; i++) (i, items[i])];
  indexed.sort((a, b) {
    final ta = timeOf(a.$2);
    final tb = timeOf(b.$2);
    if (ta == null || tb == null) {
      if (ta == null && tb == null) return a.$1.compareTo(b.$1);
      return ta == null ? 1 : -1;
    }
    final c = sort == ExecSort.newest ? tb.compareTo(ta) : ta.compareTo(tb);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final e in indexed) e.$2];
}

/// 実行中の表示一覧（検索・テーマ・状態で絞り、並び順で並べる）
List<ExecutingTask> applyExecutingFilter(
  List<ExecutingTask> items,
  ExecFilter filter,
  ExecLookups lookups,
) {
  final filtered = items.where((t) {
    if (filter.status == ExecStatusFilter.running && t.isWaitingForInput) return false;
    if (filter.status == ExecStatusFilter.waitingForInput && !t.isWaitingForInput) return false;
    if (!filter.matchesTheme(_themeOf(lookups, t.taskId, parentId: t.parentId))) return false;
    return _matchesQuery(taskTitleOrFallback(lookups.titles, t.taskId), filter.query);
  }).toList();
  return _sortByTime(filtered, (t) => t.startedAt ?? t.sessionStartedAt, filter.sort);
}

/// 再開可能の表示一覧（canResume のみ。検索・テーマで絞り、並び順で並べる）
List<ResumableExecution> applyResumableFilter(
  List<ResumableExecution> items,
  ExecFilter filter,
  ExecLookups lookups,
) {
  final filtered = items.where((e) {
    if (!e.canResume) return false;
    if (!filter.matchesTheme(_themeOf(lookups, e.taskId))) return false;
    final title = e.taskTitle ?? taskTitleOrFallback(lookups.titles, e.taskId);
    return _matchesQuery(title, filter.query);
  }).toList();
  return _sortByTime(filtered, (e) => e.startedAt ?? e.createdAt, filter.sort);
}

/// 自動実行カードのテーマ（テーマと、テーマ名の検索で絞る。並び順は元のまま）
List<TaskTheme> applyAutoRunThemeFilter(List<TaskTheme> themes, ExecFilter filter) {
  return themes
      .where((t) => filter.matchesTheme(t.id))
      .where((t) => _matchesQuery(t.name, filter.query))
      .toList();
}

// NOTE: 絞り込み条件は autoDispose にしない。実行画面を離れて戻っても、アプリの起動中は条件を保つ
// （nav66: autoDispose の保持は一覧の再利用や画面遷移で消えた）。端末への永続化はしない。

/// 実行画面の絞り込み条件（セッション内で保持）
final execFilterProvider = StateProvider<ExecFilter>((ref) => const ExecFilter());

/// taskId → テーマID。taskTitleLookupProvider と同じタスク一覧（フィルタなし）から引く。
/// 一覧が未取得・失敗のときは空（テーマで絞ると該当なしになる）
final taskThemeLookupProvider = Provider<Map<String, String>>((ref) {
  return buildTaskThemeLookup(ref.watch(taskListProvider(const TaskFilter())).valueOrNull);
});

/// 絞り込みに使う突合表（タスク名・テーマ）
final execLookupsProvider = Provider<ExecLookups>((ref) {
  return ExecLookups(
    titles: ref.watch(taskTitleLookupProvider),
    themes: ref.watch(taskThemeLookupProvider),
  );
});
