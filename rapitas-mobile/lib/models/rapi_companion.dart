// ラピ伴走化 第1段階の、カードに出す形（設計 3章段B・4.3）。
//
// - 完了条件の1件ずつの見せ方（誰が確かめるか・確かめにくい言葉と言い換えの案・ラピが補ったか）と、
//   spec-quality-checker による採点。サーバーの task-draft / roadmap/draft が返す。
// - 「伴走して」「伴走をやめて」の下書き（POST /assistant/companion/draft）。
//
// 「誰が確かめるか」で保存先が分かれる（設計 4.1 案1。Q2 は 2026-11-12 本人承認）：
// 陪審が確かめる条件は acceptanceCriteria、本人が確かめる条件は userAcceptanceChecks。
// 分けるのはサーバー（確定時に同じ規則で判定し直す）。カードのタグもサーバーの判定を出す。

/// 完了条件を確かめる人。jury＝陪審が差分で確かめる、user＝本人が確かめる
enum RapiCriterionVerifier { jury, user }

/// 完了条件1件の、カードでの見せ方
class RapiCriterionItem {
  final String text;
  final RapiCriterionVerifier verifier;

  /// 確かめにくい言葉（例「使いやすい」）と、言い換えの案。無ければ null
  final String? vagueTerm;
  final String? vagueSuggestion;

  /// ラピが3件に届かせるために補った条件か（読み取った案ではない）
  final bool supplemented;

  /// 材料が少なく、ラピが具体的に書けなかった仮の文か（確定前に直してもらう）
  final bool generic;

  /// 利用者がカードで文言を直したか
  final bool edited;

  /// 直した文の判定者・言い換えの案を、サーバーに問い合わせ中か
  final bool pending;

  const RapiCriterionItem({
    required this.text,
    this.verifier = RapiCriterionVerifier.jury,
    this.vagueTerm,
    this.vagueSuggestion,
    this.supplemented = false,
    this.generic = false,
    this.edited = false,
    this.pending = false,
  });

  /// 文言を [next] に直した行。判定者・言い換えの案はサーバーの判定が届くまで pending
  RapiCriterionItem rewritten(String next) => RapiCriterionItem(
        text: next,
        verifier: verifier,
        supplemented: supplemented,
        edited: true,
        pending: true,
      );

  /// サーバーの判定 [server] を、この行の「直したか」の印を残して当てる
  RapiCriterionItem reviewed(RapiCriterionItem server) => RapiCriterionItem(
        text: text,
        verifier: server.verifier,
        vagueTerm: server.vagueTerm,
        vagueSuggestion: server.vagueSuggestion,
        supplemented: supplemented && !edited,
        generic: server.generic,
        edited: edited,
      );

  /// 問い合わせに失敗したとき：判定は確定時にサーバーが行うので、待ちの印だけ外す
  RapiCriterionItem settled() => RapiCriterionItem(
        text: text,
        verifier: verifier,
        vagueTerm: vagueTerm,
        vagueSuggestion: vagueSuggestion,
        supplemented: supplemented,
        generic: generic,
        edited: edited,
      );

  factory RapiCriterionItem.fromJson(Map<String, dynamic> json) {
    final vague = json['vague'];
    final v = vague is Map ? Map<String, dynamic>.from(vague) : const <String, dynamic>{};
    return RapiCriterionItem(
      text: json['text']?.toString() ?? '',
      verifier: json['verifier'] == 'user' ? RapiCriterionVerifier.user : RapiCriterionVerifier.jury,
      vagueTerm: v['term'] is String ? v['term'] as String : null,
      vagueSuggestion: v['suggestion'] is String ? v['suggestion'] as String : null,
      supplemented: json['supplemented'] == true,
      generic: json['generic'] == true,
    );
  }

  /// 判定者の表示名
  String get verifierLabel => verifier == RapiCriterionVerifier.user ? '本人が確かめる' : '陪審が確かめる';
}

/// 完了条件の採点（spec-quality-checker の点数と、確かめにくい条件の数）
class RapiCriteriaQuality {
  final int score;
  final bool isAdequate;
  final int vagueCount;
  final List<String> reasons;

  const RapiCriteriaQuality({
    required this.score,
    this.isAdequate = false,
    this.vagueCount = 0,
    this.reasons = const [],
  });

  /// 読めない形なら null（古いサーバーは返さない）
  static RapiCriteriaQuality? fromJson(Object? json) {
    if (json is! Map) return null;
    final score = json['score'];
    if (score is! num) return null;
    final count = json['vagueCount'];
    final reasons = json['reasons'];
    return RapiCriteriaQuality(
      score: score.round(),
      isAdequate: json['isAdequate'] == true,
      vagueCount: count is num ? count.round() : 0,
      reasons: reasons is List ? reasons.whereType<String>().toList() : const [],
    );
  }
}

/// 一覧の JSON から、読める項目だけを取り出す
List<RapiCriterionItem> rapiCriterionItems(Object? json) => json is List
    ? json
        .whereType<Map>()
        .map((m) => RapiCriterionItem.fromJson(Map<String, dynamic>.from(m)))
        .where((i) => i.text.isNotEmpty)
        .toList()
    : const [];

/// 伴走の依頼の向き
enum RapiCompanionAction { start, stop }

/// 「伴走して」「伴走をやめて」の対象と今の状態（確認カードに出す）
class RapiCompanionProposal {
  final RapiCompanionAction action;
  final String taskId;
  final String title;

  /// いま伴走中か
  final bool active;

  const RapiCompanionProposal({
    required this.action,
    required this.taskId,
    required this.title,
    this.active = false,
  });
}

/// POST /assistant/companion/draft の結果
class RapiCompanionDraft {
  /// 伴走の開始・終了の依頼だったか。false なら、ふつうの相談として送る
  final bool matched;
  final RapiCompanionAction? action;

  /// 対象のタスクが決まっていない（タスクを選ばせる）
  final bool needsTask;

  /// 依頼が今は当てはまらない理由（already_active / not_active / task_done）
  final String? unavailable;
  final RapiCompanionProposal? proposal;

  const RapiCompanionDraft({
    required this.matched,
    this.action,
    this.needsTask = false,
    this.unavailable,
    this.proposal,
  });

  factory RapiCompanionDraft.fromJson(Map<String, dynamic> json) {
    RapiCompanionAction? actionOf(Object? v) => v == 'start'
        ? RapiCompanionAction.start
        : v == 'stop'
            ? RapiCompanionAction.stop
            : null;
    final action = actionOf(json['action']);
    final p = json['proposal'];
    RapiCompanionProposal? proposal;
    if (p is Map && action != null) {
      final taskId = p['taskId'];
      if (taskId is num) {
        proposal = RapiCompanionProposal(
          action: actionOf(p['action']) ?? action,
          taskId: '${taskId.round()}',
          title: p['title']?.toString() ?? '',
          active: p['active'] == true,
        );
      }
    }
    return RapiCompanionDraft(
      // 向きの読めない応答は依頼と見なさない（ふつうの相談に戻す）
      matched: json['matched'] == true && action != null,
      action: action,
      needsTask: json['needsTask'] == true,
      unavailable: json['unavailable'] is String ? json['unavailable'] as String : null,
      proposal: proposal,
    );
  }
}

/// 発言に「伴走」が入っているか。入っていれば、送る前にサーバーへ伴走の依頼かを聞く
/// （開始・終了の見分けはサーバーの companion-intent が行う。ここは聞くかどうかだけ）
bool rapiMentionsCompanion(String text) => text.contains('伴走');
