// 既存タスクの完了条件を変えるカード（設計 段E・§7 第2段階 項目3）の材料と状態。
//
// 流れ：今の条件を直す（editing）→「下書きを作る」で POST /assistant/criteria-draft（書き込まない）→
// 差分（足す・消す・言い換え）と理由を確かめる（proposed）→「この内容で確定」で
// POST /assistant/task-criteria（confirmed: true と、下書きを作った時点の版 expectedCriteriaRevision）→
// 「取り消す」で POST /assistant/task-criteria/revert。
// 形はバックエンド rapitas-backend/routes/ai/assistant-criteria.routes.ts が正。
// 版がずれていれば（criteria_changed_since）409 で断られるので、最新の条件から作り直してもらう。

import 'rapi_companion.dart';
import 'rapi_criteria_edit.dart';

/// criteria-draft が返す下書き（陪審が確かめる acceptanceCriteria だけを扱う）
class RapiCriteriaDraft {
  final String taskId;
  final String title;

  /// 下書きを作った時点の条件の版。確定のときにそのまま送り返す
  final String criteriaRevision;
  final List<String> before;
  final List<String> after;
  final String reason;

  /// いま変えられない理由（review_in_progress / task_done）。null なら変えられる
  final String? blockedBy;
  final String? blockedMessage;

  const RapiCriteriaDraft({
    required this.taskId,
    required this.title,
    required this.criteriaRevision,
    required this.before,
    required this.after,
    required this.reason,
    this.blockedBy,
    this.blockedMessage,
  });

  factory RapiCriteriaDraft.fromJson(Map<String, dynamic> json) {
    final before = json['before'];
    final after = json['after'];
    final blocked = json['blockedBy'];
    final message = json['blockedMessage'];
    return RapiCriteriaDraft(
      taskId: '${json['taskId']}',
      title: json['title']?.toString() ?? '',
      criteriaRevision: json['criteriaRevision']?.toString() ?? '',
      before: _criteriaOf(before),
      after: _criteriaOf(after),
      reason: json['reason']?.toString() ?? '',
      blockedBy: blocked is String && blocked.isNotEmpty ? blocked : null,
      blockedMessage: message is String && message.isNotEmpty ? message : null,
    );
  }
}

/// task-criteria（確定）と revert（取り消し）の結果
class RapiCriteriaChangeResult {
  /// 取り消しに使う操作の番号
  final int actionId;
  final List<String> before;
  final List<String> after;

  const RapiCriteriaChangeResult({
    required this.actionId,
    required this.before,
    required this.after,
  });

  factory RapiCriteriaChangeResult.fromJson(Map<String, dynamic> json) {
    final id = json['actionId'];
    return RapiCriteriaChangeResult(
      actionId: id is num ? id.toInt() : int.tryParse('$id') ?? 0,
      before: _criteriaOf(json['before']),
      after: _criteriaOf(json['after']),
    );
  }
}

List<String> _criteriaOf(Object? lists) {
  if (lists is! Map) return const [];
  final ac = lists['acceptanceCriteria'];
  return ac is List ? ac.whereType<String>().toList() : const [];
}

enum RapiCriteriaDiffKind { added, removed, reworded }

/// 差分の1行。言い換えは before と after の両方を持つ
class RapiCriteriaDiffRow {
  final RapiCriteriaDiffKind kind;
  final String? before;
  final String? after;

  const RapiCriteriaDiffRow(this.kind, {this.before, this.after});

  @override
  bool operator ==(Object other) =>
      other is RapiCriteriaDiffRow &&
      other.kind == kind &&
      other.before == before &&
      other.after == after;

  @override
  int get hashCode => Object.hash(kind, before, after);

  @override
  String toString() => 'RapiCriteriaDiffRow(${kind.name}, $before → $after)';
}

/// [before] から [after] への差分。[rewordings]（直す前の文 → 直した文）にある対は「言い換え」に
/// まとめ、残りは消した条件・足した条件として並べる。
/// NOTE: 位置で対にはしない。外した条件の位置に足した条件が来ると、言い換えに見えてしまうため。
/// 言い換えと言えるのは、カードの鉛筆で直した条件だけ。
List<RapiCriteriaDiffRow> criteriaDiffRows(List<String> before, List<String> after,
    {Map<String, String> rewordings = const {}}) {
  final removed = [for (final b in before) if (!after.contains(b)) b];
  final added = [for (final a in after) if (!before.contains(a)) a];
  final reworded = <RapiCriteriaDiffRow>[];
  for (final b in [...removed]) {
    final a = rewordings[b];
    if (a != null && added.contains(a)) {
      reworded.add(RapiCriteriaDiffRow(RapiCriteriaDiffKind.reworded, before: b, after: a));
      removed.remove(b);
      added.remove(a);
    }
  }
  return [
    ...reworded,
    for (final r in removed) RapiCriteriaDiffRow(RapiCriteriaDiffKind.removed, before: r),
    for (final a in added) RapiCriteriaDiffRow(RapiCriteriaDiffKind.added, after: a),
  ];
}

/// カードの段階。
/// editing（条件を直す）→ drafting → proposed（差分を確かめる）→ applying → applied（取り消せる）
/// → reverting → reverted。確定の応答が失われたら applyUnknown（押し直させない）。
/// 取り消せる記録が無ければ revertUnavailable。
enum RapiCriteriaPhase {
  editing,
  drafting,
  proposed,
  applying,
  applied,
  reverting,
  reverted,
  applyUnknown,
  revertUnavailable,
}

/// 完了条件の変更カード1枚の状態
class RapiCriteriaCard {
  final String taskId;
  final String title;

  /// 直し始めたときの今の条件（変わったかの見分けに使う）
  final List<String> base;
  final RapiCriteriaEdit edit;
  final String reason;
  final RapiCriteriaPhase phase;
  final RapiCriteriaDraft? draft;
  final RapiCriteriaChangeResult? result;

  /// 確定・取り消しが 409 で断られた理由（criteria_changed_since / review_in_progress / task_done）
  final String? refusal;

  /// カード内に出す案内
  final String? error;

  const RapiCriteriaCard({
    required this.taskId,
    required this.title,
    required this.base,
    required this.edit,
    this.reason = '',
    this.phase = RapiCriteriaPhase.editing,
    this.draft,
    this.result,
    this.refusal,
    this.error,
  });

  /// 今の条件 [criteria] から直し始めるカード
  factory RapiCriteriaCard.start({
    required String taskId,
    required String title,
    required List<String> criteria,
    String reason = '',
    String? error,
  }) =>
      RapiCriteriaCard(
        taskId: taskId,
        title: title,
        base: criteria,
        edit: RapiCriteriaEdit(items: [for (final c in criteria) RapiCriterionItem(text: c)]),
        reason: reason,
        error: error,
      );

  RapiCriteriaCard copyWith({
    RapiCriteriaEdit? edit,
    String? reason,
    RapiCriteriaPhase? phase,
    Object? draft = _unset,
    RapiCriteriaChangeResult? result,
    Object? refusal = _unset,
    Object? error = _unset,
  }) =>
      RapiCriteriaCard(
        taskId: taskId,
        title: title,
        base: base,
        edit: edit ?? this.edit,
        reason: reason ?? this.reason,
        phase: phase ?? this.phase,
        draft: identical(draft, _unset) ? this.draft : draft as RapiCriteriaDraft?,
        result: result ?? this.result,
        refusal: identical(refusal, _unset) ? this.refusal : refusal as String?,
        error: identical(error, _unset) ? this.error : error as String?,
      );

  /// 送る条件（外したものを除く）
  List<String> get proposed => edit.selected;

  /// 今の条件から変わったか
  bool get changed {
    final next = proposed;
    if (next.length != base.length) return true;
    for (var i = 0; i < next.length; i++) {
      if (next[i] != base[i]) return true;
    }
    return false;
  }

  /// 鉛筆で直した条件の対（直す前の文 → 直した文）。一覧の頭の [base] 件は今の条件と同じ並びで、
  /// 足した条件はその後ろに付くので、番号で元の文と対にできる
  Map<String, String> get rewordings => {
        for (var i = 0; i < base.length && i < edit.items.length; i++)
          if (!edit.excluded.contains(i) && edit.items[i].text != base[i])
            base[i]: edit.items[i].text,
      };

  /// 差分の行（下書き・確定の結果。[result] があればそれを、無ければ下書きを使う）
  List<RapiCriteriaDiffRow> get rows {
    final r = result;
    final d = draft;
    if (r != null) return criteriaDiffRows(r.before, r.after, rewordings: rewordings);
    if (d != null) return criteriaDiffRows(d.before, d.after, rewordings: rewordings);
    return const [];
  }

  /// 「下書きを作る」を押せるか（条件が1つ以上・変わっている・理由がある）
  bool get canDraft =>
      phase == RapiCriteriaPhase.editing &&
      proposed.isNotEmpty &&
      changed &&
      reason.trim().isNotEmpty;

  /// 「この内容で確定」を押せるか（下書きの時点で変えられない・断られたあとは出さない）
  bool get canApply =>
      phase == RapiCriteriaPhase.proposed && draft?.blockedBy == null && refusal == null;

  bool get canRevert => phase == RapiCriteriaPhase.applied && result != null && refusal == null;
}

const Object _unset = Object();
