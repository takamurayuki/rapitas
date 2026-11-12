import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/backlog.dart';
import 'service_providers.dart';

/// アイデア一覧の絞り込み条件。タスク一覧の TaskFilter と同じく値オブジェクト＋== 比較で、
/// `filter != const IdeaFilter()` を「絞り込み中」（バッジ・チップ・0件表示の出し分け）に使う。
class IdeaFilter {
  /// テーマID。null は指定なし
  final String? themeId;

  /// urgent / high / medium / low。null は指定なし
  final String? priority;

  /// open（未使用）/ used（使用済み）。null は「すべて」
  ///
  /// NOTE: 「すべて」は status を送らない。バックエンドは未指定と 'all' を同じく
  /// 状態で絞らない扱いにしており（idea-box-service.ts buildWhereClause）、
  /// 未指定なら改修前と同一のリクエストになる。
  final String? status;

  /// キーワード（タイトル・本文の部分一致）。空文字は指定なし
  final String search;

  const IdeaFilter({this.themeId, this.priority, this.status, this.search = ''});

  /// 指定した項目だけ差し替えた条件を返す。clearXxx で個別に解除する。
  IdeaFilter copyWith({
    String? themeId,
    String? priority,
    String? status,
    String? search,
    bool clearThemeId = false,
    bool clearPriority = false,
    bool clearStatus = false,
  }) {
    return IdeaFilter(
      themeId: clearThemeId ? null : (themeId ?? this.themeId),
      priority: clearPriority ? null : (priority ?? this.priority),
      status: clearStatus ? null : (status ?? this.status),
      search: search ?? this.search,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is IdeaFilter &&
          themeId == other.themeId &&
          priority == other.priority &&
          status == other.status &&
          search == other.search;

  @override
  int get hashCode => Object.hash(themeId, priority, status, search);
}

final ideaFilterProvider = StateProvider<IdeaFilter>((ref) => const IdeaFilter());

/// アイデア一覧（先頭100件）。絞り込み条件を watch するので、条件が変わると取り直す。
///
/// NOTE: タスク一覧は family だが、こちらは引数なしのまま条件を内部で watch する。
/// 作成画面・音声操作が `ideaListProvider` をそのまま invalidate / read しており、
/// それらが絞り込み状態を保ったまま「いま見えている一覧」を対象にできるようにするため。
final ideaListProvider = FutureProvider<List<Idea>>((ref) async {
  final filter = ref.watch(ideaFilterProvider);
  return ref.watch(backlogServiceProvider).getIdeas(
        themeId: filter.themeId,
        priority: filter.priority,
        status: filter.status,
        search: filter.search.trim(),
      );
});

final concernListProvider = FutureProvider<List<Concern>>((ref) async {
  return ref.watch(backlogServiceProvider).getConcerns();
});

final hypothesisListProvider = FutureProvider<List<Hypothesis>>((ref) async {
  return ref.watch(backlogServiceProvider).getHypotheses();
});
