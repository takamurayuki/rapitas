// 確定前の完了条件の編集状態（設計 3章段B「ユーザーは条件の採否・文言を決める」）。
//
// 起票カードと計画カードの手順ごとに1つずつ持つ。採る／外す・文言の直しを受け、
// 確定時に送る2列（陪審が確かめる acceptanceCriteria／本人が確かめる userAcceptanceChecks）を返す。
//
// 判定者・言い換えの案・採点は、直すたびにサーバー（POST /assistant/criteria/review）に
// 問い合わせ直す。サーバーの判定が正で、確定時もサーバーが同じ規則で分け直す。
// 問い合わせ中・失敗したときの表示は pending／reviewFailed で出し分ける。

import 'rapi_companion.dart';

class RapiCriteriaEdit {
  final List<RapiCriterionItem> items;

  /// 外した条件の番号（0 始まり）
  final Set<int> excluded;
  final RapiCriteriaQuality? quality;

  /// ラピの仮の案（読み取った案が無かった）か
  final bool fallback;

  /// 何度目の変更か。古い問い合わせの結果を新しい状態に当てないために使う
  final int revision;

  /// 直近の問い合わせに失敗した（判定は確定時にサーバーが行う）
  final bool reviewFailed;

  const RapiCriteriaEdit({
    this.items = const [],
    this.excluded = const {},
    this.quality,
    this.fallback = false,
    this.revision = 0,
    this.reviewFailed = false,
  });

  RapiCriteriaEdit _with({
    List<RapiCriterionItem>? items,
    Set<int>? excluded,
    Object? quality = _keep,
    bool? reviewFailed,
    bool bump = false,
  }) =>
      RapiCriteriaEdit(
        items: items ?? this.items,
        excluded: excluded ?? this.excluded,
        quality: identical(quality, _keep) ? this.quality : quality as RapiCriteriaQuality?,
        fallback: fallback,
        revision: bump ? revision + 1 : revision,
        reviewFailed: reviewFailed ?? this.reviewFailed,
      );

  /// [index] を採る／外す
  RapiCriteriaEdit toggled(int index) {
    if (index < 0 || index >= items.length) return this;
    final next = {...excluded};
    if (!next.remove(index)) next.add(index);
    return _with(excluded: next, bump: true);
  }

  /// [index] の文言を [text] に直す。空や変わらない文なら何もしない。
  /// 直した条件は採る側に戻す（直すのは残したいから）
  RapiCriteriaEdit rewritten(int index, String text) {
    final next = text.trim();
    if (index < 0 || index >= items.length || next.isEmpty || next == items[index].text) {
      return this;
    }
    return _with(
      items: [
        for (var i = 0; i < items.length; i++) i == index ? items[i].rewritten(next) : items[i],
      ],
      excluded: {...excluded}..remove(index),
      bump: true,
    );
  }

  /// 条件 [text] を末尾に足す（採る側）。空や既にある文なら何もしない
  RapiCriteriaEdit appended(String text) {
    final next = text.trim();
    if (next.isEmpty || items.any((i) => i.text == next)) return this;
    return _with(items: [...items, RapiCriterionItem(text: next)], bump: true);
  }

  /// 問い合わせを待たずに、直した行の「確認中」を下ろす（既存タスクの条件変更カードは
  /// 判定の問い合わせをしない。判定者の振り分けは陪審の列だけを扱うため）
  RapiCriteriaEdit settled() =>
      _with(items: [for (final i in items) i.pending ? i.settled() : i]);

  /// 確定時に送る条件（外したものを除く。並びはカードのまま）
  List<String> get selected => [
        for (var i = 0; i < items.length; i++)
          if (!excluded.contains(i)) items[i].text,
      ];

  /// 送る条件のうち、陪審が確かめるもの（acceptanceCriteria）
  List<String> get selectedJury => [
        for (var i = 0; i < items.length; i++)
          if (!excluded.contains(i) && items[i].verifier == RapiCriterionVerifier.jury)
            items[i].text,
      ];

  /// 送る条件のうち、本人が確かめるもの（userAcceptanceChecks）
  List<String> get selectedUser => [
        for (var i = 0; i < items.length; i++)
          if (!excluded.contains(i) && items[i].verifier == RapiCriterionVerifier.user)
            items[i].text,
      ];

  /// 判定の問い合わせ中か（直した直後）
  bool get pending => items.any((i) => i.pending);

  /// サーバーの判定 [reviewed]（[selected] と同じ順）と採点を当てる。
  /// [atRevision] が今の版と違えば（その後また直した）当てない
  RapiCriteriaEdit applyReview(
    int atRevision,
    List<RapiCriterionItem> reviewed,
    RapiCriteriaQuality? nextQuality,
  ) {
    if (atRevision != revision) return this;
    final byText = {for (final r in reviewed) r.text: r};
    return _with(
      items: [
        for (final item in items)
          byText[item.text] != null ? item.reviewed(byText[item.text]!) : item.settled(),
      ],
      quality: nextQuality ?? quality,
      reviewFailed: false,
    );
  }

  /// 問い合わせに失敗した。採点は古いまま残すと誤解を招くので消す
  RapiCriteriaEdit reviewFailedAt(int atRevision) {
    if (atRevision != revision) return this;
    return _with(
      items: [for (final i in items) i.settled()],
      quality: null,
      reviewFailed: true,
    );
  }
}

const Object _keep = Object();
