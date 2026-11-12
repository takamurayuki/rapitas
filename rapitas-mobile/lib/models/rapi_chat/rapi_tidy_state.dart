// ラピの会話の片付け（tidy）カードの状態。
//
// NOTE: provider の分割（nav39 v1-0a）で rapi_chat_provider.dart から移した。挙動は変えていない。

import '../rapi.dart';

const Object _unset = Object();

/// 片付けの候補の出し方。condition（条件で選ぶ：delete-filter）／text（文章で選ぶ：delete-draft）
enum RapiTidyHow { condition, text }

/// 片付けカードの段階。
/// setup（出し方と条件を選ぶ）→ searching → listing（候補をチェックで選ぶ）→ deleting → done（結果と取り消し）。
/// 候補が無かった・出せなかったときは setup に戻して理由を出す。
enum RapiTidyPhase { setup, searching, listing, deleting, done }

/// 削除したタスク1件の取り消しの状態。
/// unavailable はサーバーが 409 not_restorable を返した（復元済み・控えが無い）ので押し直させない。
/// failed は通信の失敗など（押し直してよい：復元済みなら2回目は not_restorable になるだけ）
enum RapiTidyRestore { idle, restoring, restored, unavailable, failed }

/// 片付け（tidy）カード1枚の状態。カードは発言ごとに持つ（前のカードの「元に戻す」を残すため）
class RapiTidyCard {
  /// 振り分けられた発言（文章で選ぶときの依頼文）
  final String text;
  final RapiTidyHow how;
  final TidyFilter filter;
  final RapiTidyPhase phase;

  /// いま出している候補（画面に出たもの。削除するのはこのうちチェックが残ったものだけ）
  final List<TidyItem> items;
  final Set<String> chosen;

  /// 候補をどちらの出し方で出したか（listing 以降の表示に使う）
  final RapiTidyHow listedBy;

  /// 条件で選んだとき：該当の総数・一覧に載りきらなかったか・保護で外した件数
  final int total;
  final bool truncated;
  final int excludedProtected;

  /// 文章で選んだとき：検討したタスク数と、判断できなかったこと
  final int considered;
  final List<String> unclear;

  /// 一覧を全部出しているか（長い一覧は先頭だけ出す）
  final bool expanded;

  /// 削除の進み具合（終えた回数, 全回数）
  final (int, int)? progress;

  /// 削除の結果（done）
  final TaskDeleteRun? run;

  /// 取り消しの状態（trashId ごと）
  final Map<int, RapiTidyRestore> restores;

  /// setup に出す案内（該当なし・候補を出せなかった など）
  final String? notice;

  /// カード内に出す失敗の案内
  final String? error;

  const RapiTidyCard({
    required this.text,
    this.how = RapiTidyHow.condition,
    this.filter = const TidyFilter(),
    this.phase = RapiTidyPhase.setup,
    this.items = const [],
    this.chosen = const {},
    this.listedBy = RapiTidyHow.condition,
    this.total = 0,
    this.truncated = false,
    this.excludedProtected = 0,
    this.considered = 0,
    this.unclear = const [],
    this.expanded = false,
    this.progress,
    this.run,
    this.restores = const {},
    this.notice,
    this.error,
  });

  RapiTidyCard copyWith({
    RapiTidyHow? how,
    TidyFilter? filter,
    RapiTidyPhase? phase,
    List<TidyItem>? items,
    Set<String>? chosen,
    RapiTidyHow? listedBy,
    int? total,
    bool? truncated,
    int? excludedProtected,
    int? considered,
    List<String>? unclear,
    bool? expanded,
    Object? progress = _unset,
    TaskDeleteRun? run,
    Map<int, RapiTidyRestore>? restores,
    Object? notice = _unset,
    Object? error = _unset,
  }) =>
      RapiTidyCard(
        text: text,
        how: how ?? this.how,
        filter: filter ?? this.filter,
        phase: phase ?? this.phase,
        items: items ?? this.items,
        chosen: chosen ?? this.chosen,
        listedBy: listedBy ?? this.listedBy,
        total: total ?? this.total,
        truncated: truncated ?? this.truncated,
        excludedProtected: excludedProtected ?? this.excludedProtected,
        considered: considered ?? this.considered,
        unclear: unclear ?? this.unclear,
        expanded: expanded ?? this.expanded,
        progress: identical(progress, _unset) ? this.progress : progress as (int, int)?,
        run: run ?? this.run,
        restores: restores ?? this.restores,
        notice: identical(notice, _unset) ? this.notice : notice as String?,
        error: identical(error, _unset) ? this.error : error as String?,
      );

  /// 長い一覧で、最初に出す件数（残りは「残りも表示」で出す）
  static const int previewRows = 20;

  /// 画面に出している候補（畳んでいる間は先頭 [previewRows] 件）
  List<TidyItem> get visibleItems =>
      expanded || items.length <= previewRows ? items : items.sublist(0, previewRows);

  /// まだ出していない候補の数
  int get hiddenCount => items.length - visibleItems.length;

  /// 削除に送る id：画面に出ている候補のうちチェックが残ったもの（候補の順）。
  /// 畳んで出していない候補は、チェックが付いていても送らない（見ていないものは消さない）
  List<String> get chosenIds =>
      [for (final i in visibleItems) if (chosen.contains(i.id)) i.id];

  /// 「削除する」を押せるか
  bool get canDelete => phase == RapiTidyPhase.listing && chosenIds.isNotEmpty;

  /// 「候補を出す」を押せるか（条件は状態を1つ以上。文章は依頼文がある）
  bool get canSearch =>
      phase == RapiTidyPhase.setup &&
      (how == RapiTidyHow.condition ? filter.canPreview : text.trim().isNotEmpty);

  /// どれかを戻している最中か
  bool get restoring => restores.values.contains(RapiTidyRestore.restoring);

  /// 取り消しの状態（記録が無ければ idle）
  RapiTidyRestore restoreOf(int trashId) => restores[trashId] ?? RapiTidyRestore.idle;

  /// まだ戻せる（戻していない・前回失敗した）ゴミ箱の行
  List<int> get restorable => [
        for (final d in run?.deleted ?? const <TaskDeletion>[])
          if (d.trashId case final t?)
            if (restoreOf(t) == RapiTidyRestore.idle || restoreOf(t) == RapiTidyRestore.failed) t,
      ];

  /// id から候補の題名を引く（結果の表示用）
  String titleOf(String id) {
    for (final i in items) {
      if (i.id == id) return i.title;
    }
    return 'タスク#$id';
  }
}
