// 会話スペースから読んだ行（SavedMessage）を、画面に出す記録（RapiMessage）に戻す（設計 nav39 3.4・5章）。
//
// 戻した行は archived（読み取り専用）。形の版が新しすぎる・知らない種類・読めない JSON のときは
// 例外にせず、本文だけを出して unsupported の印を付ける（カードの位置に「表示できません」を出す）。

import 'dart:convert';

import '../rapi.dart';
import 'rapi_chat_cards.dart';
import 'rapi_chat_message.dart';
import 'rapi_snapshot_encode.dart' show rapiSnapshotVersion;
import 'rapi_tidy_state.dart';
import 'saved_message.dart';

/// 読んだ行 [s] を、端末内の id [id] の記録にする
RapiMessage decodeSavedMessage(SavedMessage s, {required int id}) {
  final role = switch (s.role) {
    'user' => RapiRole.user,
    'assistant' => RapiRole.assistant,
    _ => RapiRole.system,
  };
  RapiMessage base({
    AskAnswer? answer,
    RapiChangeCard? change,
    RapiRoadmapCard? roadmap,
    RapiTidyCard? tidy,
    RapiCompanionCard? companion,
    RapiCriteriaCard? criteria,
    bool unsupported = false,
  }) =>
      RapiMessage(
        id: id,
        role: role,
        text: s.text,
        answer: answer,
        change: change,
        roadmap: roadmap,
        tidy: tidy,
        companion: companion,
        criteria: criteria,
        taskId: s.taskId?.toString(),
        inHistory: s.inHistory,
        clientId: s.clientId,
        archived: true,
        savedAt: s.createdAt ?? s.clientCreatedAt,
        unsupported: unsupported,
      );

  final payload = s.payload;
  if (s.kind == 'text' || payload == null) {
    return base(unsupported: s.kind != 'text');
  }
  try {
    final env = jsonDecode(payload);
    if (env is! Map) return base(unsupported: true);
    final v = env['v'];
    final body = env[s.kind];
    if (v is! int || v > rapiSnapshotVersion || env['kind'] != s.kind || body is! Map) {
      return base(unsupported: true);
    }
    final json = Map<String, dynamic>.from(body);
    return switch (s.kind) {
      'answer' => base(answer: AskAnswer.fromJson(json)),
      'change' => base(change: _change(json)),
      'roadmap' => base(roadmap: _roadmap(json)),
      'tidy' => base(tidy: _tidy(json)),
      'companion' => base(companion: _companion(json)),
      'criteria' => base(criteria: _criteria(json)),
      _ => base(unsupported: true),
    };
  } on Object {
    // NOTE: 形の崩れた記録で画面を落とさない（設計 3.4）。本文だけを出す
    return base(unsupported: true);
  }
}

Map<String, dynamic> _map(Object? v) =>
    v is Map ? Map<String, dynamic>.from(v) : const <String, dynamic>{};

List<String> _strings(Object? v) => v is List ? [for (final x in v) if (x is String) x] : const [];

String? _str(Object? v) => v is String ? v : null;

int _int(Object? v) => v is num ? v.toInt() : 0;

/// 段階の名前を引く。知らない名前は形の不一致として扱う（呼び出し側で unsupported になる）
T _phase<T extends Enum>(List<T> values, Object? name) =>
    values.firstWhere((e) => e.name == name, orElse: () => throw const FormatException('phase'));

RapiChangeCard _change(Map<String, dynamic> j) {
  final result = j['result'];
  return RapiChangeCard(
    proposal: ChangeProposal.fromJson(_map(j['proposal'])),
    considered: _int(j['considered']),
    phase: _phase(RapiChangePhase.values, j['phase']),
    result: result is Map ? TaskUpdateResult.fromJson(Map<String, dynamic>.from(result)) : null,
    conflicts: _strings(j['conflicts']),
    error: _str(j['error']),
  );
}

RapiRoadmapCard _roadmap(Map<String, dynamic> j) {
  final draft = RoadmapDraft.fromJson(_map(j['draft']));
  final selected = j['selected'] is List ? j['selected'] as List : const [];
  final result = j['result'];
  final answers = j['answers'] is List ? [for (final a in j['answers'] as List) _str(a)] : <String?>[];
  return RapiRoadmapCard(
    text: _str(j['text']) ?? '',
    draft: draft,
    asked: [
      for (final q in j['asked'] is List ? j['asked'] as List : const [])
        if (q is Map) RoadmapQuestion.fromJson(Map<String, dynamic>.from(q)),
    ],
    answers: answers,
    phase: _phase(RapiRoadmapPhase.values, j['phase']),
    result: result is Map ? RoadmapCommitResult.fromJson(Map<String, dynamic>.from(result)) : null,
    error: _str(j['error']),
    // 採った条件だけを、外したものの無い編集状態として戻す（読み取り専用で出すため）
    stepCriteria: [
      for (var i = 0; i < draft.steps.length; i++)
        i < selected.length && selected[i] is Map
            ? RapiCriteriaEdit(items: [
                for (final t in _strings((selected[i] as Map)['jury'])) RapiCriterionItem(text: t),
                for (final t in _strings((selected[i] as Map)['user']))
                  RapiCriterionItem(text: t, verifier: RapiCriterionVerifier.user),
              ])
            : const RapiCriteriaEdit(),
    ],
  );
}

RapiTidyCard _tidy(Map<String, dynamic> j) {
  final filter = _map(j['filter']);
  final run = j['run'];
  final restores = _map(j['restores']);
  return RapiTidyCard(
    text: _str(j['text']) ?? '',
    how: _phase(RapiTidyHow.values, j['how']),
    filter: TidyFilter(
      themeId: _str(filter['themeId']),
      statuses: _strings(filter['statuses']),
      days: _int(filter['days']),
    ),
    phase: _phase(RapiTidyPhase.values, j['phase']),
    listedBy: _phase(RapiTidyHow.values, j['listedBy']),
    items: [
      for (final i in j['items'] is List ? j['items'] as List : const [])
        if (i is Map)
          TidyItem(
            id: '${i['id']}',
            title: _str(i['title']) ?? '',
            status: _str(i['status']) ?? '',
            updatedAt: i['updatedAt'] is String ? DateTime.tryParse(i['updatedAt'] as String) : null,
            reason: _str(i['reason']) ?? '',
          ),
    ],
    chosen: _strings(j['chosen']).toSet(),
    total: _int(j['total']),
    truncated: j['truncated'] == true,
    excludedProtected: _int(j['excludedProtected']),
    considered: _int(j['considered']),
    unclear: _strings(j['unclear']),
    run: run is Map
        ? TaskDeleteRun(
            results: [
              for (final r in run['results'] is List ? run['results'] as List : const [])
                if (r is Map)
                  TaskDeletion(
                    taskId: '${r['taskId']}',
                    outcome: _str(r['outcome']) ?? '',
                    trashId: r['trashId'] is num ? (r['trashId'] as num).toInt() : null,
                  ),
            ],
            unknown: _strings(run['unknown']),
            rejected: _strings(run['rejected']),
            unsent: _strings(run['unsent']),
          )
        : null,
    restores: {
      for (final e in restores.entries)
        if (int.tryParse(e.key) case final k?) k: _phase(RapiTidyRestore.values, e.value),
    },
    notice: _str(j['notice']),
    error: _str(j['error']),
  );
}

RapiCompanionCard _companion(Map<String, dynamic> j) {
  final p = _map(j['proposal']);
  return RapiCompanionCard(
    proposal: RapiCompanionProposal(
      action: _phase(RapiCompanionAction.values, p['action']),
      taskId: '${p['taskId']}',
      title: _str(p['title']) ?? '',
      active: p['active'] == true,
    ),
    phase: _phase(RapiCompanionPhase.values, j['phase']),
    error: _str(j['error']),
  );
}

/// 取り消しの応答を待つ間に保存した記録に添える案内（取り消せたかは断定しない）
const String rapiCriteriaRevertUnknownText =
    '取り消しの応答を待つ間に残した記録です。元に戻せたかは確かめられていません。今の完了条件はタスクを開いて確かめてください。';

RapiCriteriaCard _criteria(Map<String, dynamic> j) {
  final result = j['result'];
  final saved = _phase(RapiCriteriaPhase.values, j['phase']);
  // NOTE: 応答待ちのまま残った記録は、結果を断定しない段階で戻す（勝手に成功・失敗を言い切らない）。
  // 確定待ち（applying）は applyUnknown（反映済みかもしれない）。取り消し待ち（reverting）は、
  // 確定は済んでいる（result がある）ので applied に戻し、取り消せたかは分からないと添える
  final phase = switch (saved) {
    RapiCriteriaPhase.applying => RapiCriteriaPhase.applyUnknown,
    RapiCriteriaPhase.reverting => RapiCriteriaPhase.applied,
    // 直している途中の段階は保存しない（rapiCriteriaSaved）。来たら形の不一致として扱う
    RapiCriteriaPhase.editing || RapiCriteriaPhase.drafting || RapiCriteriaPhase.proposed =>
      throw const FormatException('phase'),
    _ => saved,
  };
  // 鉛筆で直した対を、直す前の条件（base）と直した一覧（edit）として戻す。差分の行
  // （RapiCriteriaCard.rows）が言い換えを「前 → 後」の1行にまとめるのに使う
  final rewordings = <String, String>{
    for (final e in _map(j['rewordings']).entries)
      if (e.value is String) e.key: e.value as String,
  };
  return RapiCriteriaCard(
    taskId: '${j['taskId']}',
    title: _str(j['title']) ?? '',
    base: rewordings.keys.toList(),
    edit: RapiCriteriaEdit(items: [for (final v in rewordings.values) RapiCriterionItem(text: v)]),
    reason: _str(j['reason']) ?? '',
    phase: phase,
    result: result is Map
        ? RapiCriteriaChangeResult(
            actionId: _int(result['actionId']),
            before: _strings(result['before']),
            after: _strings(result['after']),
          )
        : null,
    refusal: _str(j['refusal']),
    error: saved == RapiCriteriaPhase.reverting ? rapiCriteriaRevertUnknownText : _str(j['error']),
  );
}
