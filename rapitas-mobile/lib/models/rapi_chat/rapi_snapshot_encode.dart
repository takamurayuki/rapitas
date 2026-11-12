// 会話の1件（RapiMessage）を、会話スペースに保存する行（SavedMessage）にする（設計 nav39 3.4・6.1）。
//
// カードは画面に出していた値をそのまま JSON に写す（封筒 {"v":1,"kind":...,"<kind>":{...}}）。
// 一時的な値（片付けの一覧の展開・進み具合、完了条件の編集途中の状態）は残さない。
// 保存しない行（相談・タスク選び・下書き・挨拶・依頼の案内など）は null を返す。
// NOTE: 完了条件の変更カード（criteria）は、確定・取り消しの済んだ（または応答待ちの）カードだけを
// 保存する。直している途中・下書きを確かめている途中のカードは、カードの操作が読み取り専用の記録に
// そぐわないため保存しない（[rapiCriteriaSaved]。nav42 バッチB の rebase 移植で決めた扱い）。

import 'dart:convert';

import '../rapi.dart';
import 'rapi_chat_cards.dart';
import 'rapi_chat_message.dart';
import 'rapi_tidy_state.dart';
import 'saved_message.dart';

/// スナップショットの形の版
const int rapiSnapshotVersion = 1;

/// [m] を会話スペースに保存するか（設計 6.1 の表）
bool rapiShouldSave(RapiMessage m) =>
    m.consultTaskId == null &&
    m.consultPicker == null &&
    !m.draftSlot &&
    (m.criteria == null || rapiCriteriaSaved(m.criteria!.phase)) &&
    m.externalDraftId == null &&
    !m.localOnly;

/// 完了条件の変更カードを、段階 [phase] で保存するか。
///
/// 書き込みが済んだ段階（applied・reverted・applyUnknown・revertUnavailable）と、その応答待ち
/// （applying・reverting）は保存する。応答待ちの記録は、読み込むときに結果を断定しない段階へ戻す
/// （rapi_snapshot_decode.dart）。直している途中（editing・drafting・proposed）は保存しない。
/// 応答待ちから proposed へ戻った（断られた・失敗した）カードは、保存しない行になるので、
/// 先に保存した応答待ちの行は削除として送られる（rapi_chat_spaces_provider.dart の
/// 「画面から消えた行」と同じ扱い）。
bool rapiCriteriaSaved(RapiCriteriaPhase phase) => switch (phase) {
      RapiCriteriaPhase.editing || RapiCriteriaPhase.drafting || RapiCriteriaPhase.proposed => false,
      _ => true,
    };

/// [m] を保存する行にする。保存しない行なら null
///
/// [clientId] は行の鍵、[createdAt] は端末で足した日時
SavedMessage? encodeRapiMessage(RapiMessage m, {required String clientId, DateTime? createdAt}) {
  if (!rapiShouldSave(m)) return null;
  final (kind, body) = _card(m);
  String? payload;
  var savedKind = kind;
  if (body != null) {
    payload = _envelope(kind, body);
    if (_bytes(payload) > rapiSnapshotMaxBytes && m.tidy != null) {
      payload = _envelope(kind, _tidyJson(m.tidy!, thin: true));
    }
    // 間引いても超えるなら本文だけを残す（設計 9章）
    if (_bytes(payload) > rapiSnapshotMaxBytes) {
      payload = null;
      savedKind = 'text';
    }
  }
  return SavedMessage(
    clientId: clientId,
    role: m.role.name,
    kind: savedKind,
    text: m.text,
    taskId: m.taskId == null ? null : int.tryParse(m.taskId!),
    inHistory: m.inHistory,
    payload: payload,
    clientCreatedAt: createdAt,
  );
}

int _bytes(String s) => utf8.encode(s).length;

String _envelope(String kind, Map<String, dynamic> body) =>
    jsonEncode({'v': rapiSnapshotVersion, 'kind': kind, kind: body});

(String, Map<String, dynamic>?) _card(RapiMessage m) {
  if (m.answer case final a?) return ('answer', _answerJson(a));
  if (m.change case final c?) return ('change', _changeJson(c));
  if (m.roadmap case final r?) return ('roadmap', _roadmapJson(r));
  if (m.tidy case final t?) return ('tidy', _tidyJson(t, thin: false));
  if (m.companion case final c?) return ('companion', _companionJson(c));
  if (m.criteria case final c?) return ('criteria', _criteriaJson(c));
  return ('text', null);
}

Map<String, dynamic> _answerJson(AskAnswer a) => {
      'available': a.available,
      'total': a.total,
      'rows': [
        for (final r in a.rows)
          {
            'id': r.id,
            'title': r.title,
            'status': r.status,
            'priority': r.priority,
            'dueDate': r.dueDate?.toIso8601String(),
          },
      ],
      'unclear': a.unclear,
    };

Map<String, dynamic> _changeJson(RapiChangeCard c) => {
      'proposal': {
        'taskId': c.proposal.taskId,
        'title': c.proposal.title,
        'changes': c.proposal.changes.toJson(),
        'reason': c.proposal.reason,
      },
      'considered': c.considered,
      'phase': c.phase.name,
      'result': c.result == null
          ? null
          : {'actionId': c.result!.actionId, 'before': c.result!.before, 'after': c.result!.after},
      'conflicts': c.conflicts,
      'error': c.error,
    };

Map<String, dynamic> _roadmapJson(RapiRoadmapCard r) => {
      'text': r.text,
      'draft': {
        'goal': r.draft.goal,
        'themeChoice': r.draft.themeChoice.toJson(),
        'projectChoice': r.draft.projectChoice.toJson(),
        'questions': [
          for (final q in r.draft.questions)
            {
              'question': q.question,
              'options': q.options,
              'recommended': q.recommended,
              'recommendedReason': q.recommendedReason,
            },
        ],
        'steps': [
          for (final s in r.draft.steps)
            {
              'title': s.title,
              'description': s.description,
              'dueDate': s.dueDate,
              'acceptanceCriteria': s.acceptanceCriteria,
            },
        ],
        'deadline': r.draft.deadline,
        'assumptions': r.draft.assumptions,
        'comparisonAxes': r.draft.comparisonAxes,
      },
      'asked': [
        for (final q in r.asked) {'question': q.question, 'options': q.options},
      ],
      'answers': r.answers,
      'phase': r.phase.name,
      'result': r.result == null
          ? null
          : {
              'themeId': r.result!.themeId,
              'projectId': r.result!.projectId,
              'taskIds': r.result!.taskIds,
              'failedAfter': r.result!.failedAfter,
            },
      'error': r.error,
      // 手順ごとに「採った条件」だけを残す（編集途中の状態は残さない。設計 3.4）
      'selected': [
        for (final e in r.stepCriteria) {'jury': e.selectedJury, 'user': e.selectedUser},
      ],
    };

Map<String, dynamic> _tidyJson(RapiTidyCard t, {required bool thin}) {
  // 上限を超えるときは、選んだ・削除に出てきた候補だけを残す（設計 3.4）
  final keep = {...t.chosen, for (final r in t.run?.results ?? const <TaskDeletion>[]) r.taskId};
  final items = thin ? [for (final i in t.items) if (keep.contains(i.id)) i] : t.items;
  return {
    'text': t.text,
    'how': t.how.name,
    'filter': {'themeId': t.filter.themeId, 'statuses': t.filter.statuses, 'days': t.filter.days},
    'phase': t.phase.name,
    'listedBy': t.listedBy.name,
    'items': [
      for (final i in items)
        {
          'id': i.id,
          'title': i.title,
          'status': i.status,
          'updatedAt': i.updatedAt?.toIso8601String(),
          'reason': i.reason,
        },
    ],
    'chosen': t.chosen.toList(),
    'total': t.total,
    'truncated': t.truncated,
    'excludedProtected': t.excludedProtected,
    'considered': t.considered,
    'unclear': t.unclear,
    'run': t.run == null
        ? null
        : {
            'results': [
              for (final r in t.run!.results)
                {'taskId': r.taskId, 'outcome': r.outcome, 'trashId': r.trashId},
            ],
            'unknown': t.run!.unknown,
            'rejected': t.run!.rejected,
            'unsent': t.run!.unsent,
          },
    'restores': {for (final e in t.restores.entries) '${e.key}': e.value.name},
    'notice': t.notice,
    'error': t.error,
    if (thin) 'itemsOmitted': t.items.length - items.length,
  };
}

Map<String, dynamic> _companionJson(RapiCompanionCard c) => {
      'proposal': {
        'action': c.proposal.action.name,
        'taskId': c.proposal.taskId,
        'title': c.proposal.title,
        'active': c.proposal.active,
      },
      'phase': c.phase.name,
      'error': c.error,
    };


// 編集の状態（外した条件・足した条件の並び）は残さない。差分の行を作り直すのに要る
// 「鉛筆で直した対」（rewordings）だけを残す（設計 3.4 の「採った条件だけ」と同じ考え方）
Map<String, dynamic> _criteriaJson(RapiCriteriaCard c) => {
      'taskId': c.taskId,
      'title': c.title,
      'reason': c.reason,
      'phase': c.phase.name,
      'rewordings': c.rewordings,
      'result': c.result == null
          ? null
          : {'actionId': c.result!.actionId, 'before': c.result!.before, 'after': c.result!.after},
      'refusal': c.refusal,
      'error': c.error,
    };
