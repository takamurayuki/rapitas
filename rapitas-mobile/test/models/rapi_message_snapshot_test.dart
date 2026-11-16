import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_decode.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';

// 会話スペースのスナップショット（設計 nav39 3.4・6.1・11.2）：kind ごと・段階ごとの往復、
// 新しすぎる形・知らない種類、片付けの一覧の間引き、保存しない行。

RapiMessage _roundTrip(RapiMessage m) {
  final saved = encodeRapiMessage(m, clientId: 'c1', createdAt: DateTime.utc(2026, 11, 12))!;
  // 保存待ちの列・PUT と同じく JSON を通す
  final parsed = SavedMessage.tryParse(jsonDecode(jsonEncode(saved.toJson())))!;
  return decodeSavedMessage(parsed, id: 7);
}

const _proposal = ChangeProposal(
    taskId: '12', title: '資料づくり', changes: TaskChanges({'priority': 'high', 'dueDate': null}));

final _draft = RoadmapDraft(
  goal: '引っ越しの準備',
  themeChoice: const RoadmapPlacement(kind: 'existing', id: 3, name: '生活'),
  projectChoice: const RoadmapPlacement(kind: 'new', name: '引っ越し'),
  questions: const [RoadmapQuestion(question: 'いつ？', options: ['今月', '来月'])],
  steps: const [
    RoadmapStep(title: '見積もり', description: '3社', acceptanceCriteria: ['3社から取る']),
    RoadmapStep(title: '荷造り'),
  ],
  deadline: '2026-12-01',
);

void main() {
  test('本文・system 行は taskId と inHistory ごと往復する', () {
    final m = _roundTrip(const RapiMessage(
        id: 1, role: RapiRole.system, text: '起票しました', taskId: '42', inHistory: false));
    expect(m.role, RapiRole.system);
    expect(m.text, '起票しました');
    expect(m.taskId, '42');
    expect(m.archived, isTrue);
    expect(m.clientId, 'c1');
    expect(m.id, 7);
    expect(m.unsupported, isFalse);
  });

  test('回答カード', () {
    final m = _roundTrip(RapiMessage(
      id: 1,
      role: RapiRole.assistant,
      answer: AskAnswer(available: true, total: 3, rows: [
        AskRow(id: '5', title: '請求書', status: 'todo', priority: 'high', dueDate: DateTime.utc(2026, 11, 20)),
      ], unclear: const ['期間']),
    ));
    expect(m.answer!.total, 3);
    expect(m.answer!.rows.single.title, '請求書');
    expect(m.answer!.rows.single.dueDate, DateTime.utc(2026, 11, 20));
    expect(m.answer!.unclear, ['期間']);
  });

  test('変更カードはどの段階でも往復し、actionId を残す', () {
    for (final phase in RapiChangePhase.values) {
      final m = _roundTrip(RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        change: RapiChangeCard(
          proposal: _proposal,
          considered: 40,
          phase: phase,
          result: const TaskUpdateResult(actionId: 99, before: {'priority': 'low'}, after: {'priority': 'high'}),
          conflicts: const ['dueDate'],
          error: 'x',
        ),
      ));
      final c = m.change!;
      expect(c.phase, phase);
      expect(c.proposal.changes.values, {'priority': 'high', 'dueDate': null});
      expect(c.result!.actionId, 99);
      expect(c.result!.after, {'priority': 'high'});
      expect(c.conflicts, ['dueDate']);
      expect(c.considered, 40);
    }
  });

  test('計画カードは段階・質問・答え・結果・採った条件を往復する（編集途中の状態は残さない）', () {
    var card = RapiRoadmapCard.fromDraft('引っ越し', _draft);
    card = card.withStepCriteria(
        0, card.stepCriteria[0].toggled(0)); // 外した条件は残らない
    for (final phase in RapiRoadmapPhase.values) {
      final m = _roundTrip(RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        roadmap: card.copyWith(
            phase: phase,
            answers: ['来月'],
            result: const RoadmapCommitResult(themeId: 3, projectId: 8, taskIds: ['100', '101'])),
      ));
      final r = m.roadmap!;
      expect(r.phase, phase);
      expect(r.draft.goal, '引っ越しの準備');
      expect(r.draft.themeChoice.id, 3);
      expect(r.draft.projectChoice.name, '引っ越し');
      expect(r.draft.steps.map((s) => s.title), ['見積もり', '荷造り']);
      expect(r.asked.single.question, 'いつ？');
      expect(r.answers, ['来月']);
      expect(r.result!.taskIds, ['100', '101']);
      expect(r.stepCriteria[0].selected, isEmpty);
      expect(r.stepCriteria[0].excluded, isEmpty);
    }
  });

  test('片付けカードは段階・選択・結果・元に戻すの状態を往復し、展開と進み具合は残さない', () {
    final items = [for (var i = 0; i < 3; i++) TidyItem(id: '$i', title: 't$i', status: 'cancelled')];
    for (final phase in RapiTidyPhase.values) {
      final m = _roundTrip(RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        tidy: RapiTidyCard(
          text: '古いのを消して',
          how: RapiTidyHow.text,
          filter: const TidyFilter(themeId: '4', statuses: ['done'], days: 30),
          phase: phase,
          items: items,
          chosen: const {'1'},
          listedBy: RapiTidyHow.text,
          total: 3,
          expanded: true,
          progress: (1, 2),
          run: const TaskDeleteRun(
              results: [TaskDeletion(taskId: '1', outcome: 'deleted', trashId: 77)], unknown: ['2']),
          restores: const {77: RapiTidyRestore.restoring},
        ),
      ));
      final t = m.tidy!;
      expect(t.phase, phase);
      expect(t.how, RapiTidyHow.text);
      expect(t.filter.themeId, '4');
      expect(t.filter.days, 30);
      expect(t.items.length, 3);
      expect(t.chosen, {'1'});
      expect(t.run!.deleted.single.trashId, 77);
      expect(t.run!.unknown, ['2']);
      expect(t.restores, {77: RapiTidyRestore.restoring});
      expect(t.expanded, isFalse);
      expect(t.progress, isNull);
    }
  });

  test('伴走カード', () {
    for (final phase in RapiCompanionPhase.values) {
      final m = _roundTrip(RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        companion: RapiCompanionCard(
          proposal: const RapiCompanionProposal(
              action: RapiCompanionAction.stop, taskId: '9', title: '筋トレ', active: true),
          phase: phase,
        ),
      ));
      expect(m.companion!.phase, phase);
      expect(m.companion!.proposal.action, RapiCompanionAction.stop);
      expect(m.companion!.proposal.taskId, '9');
      expect(m.companion!.proposal.active, isTrue);
    }
  });

  test('v=2・知らない kind・壊れた JSON は例外にせず、本文だけで unsupported になる', () {
    for (final s in [
      const SavedMessage(clientId: 'a', role: 'assistant', kind: 'change', text: '本文', payload: '{"v":2,"kind":"change","change":{}}'),
      const SavedMessage(clientId: 'b', role: 'assistant', kind: 'poll', text: '本文', payload: '{"v":1,"kind":"poll","poll":{}}'),
      const SavedMessage(clientId: 'c', role: 'assistant', kind: 'tidy', text: '本文', payload: '{broken'),
      const SavedMessage(clientId: 'd', role: 'assistant', kind: 'change', text: '本文', payload: '{"v":1,"kind":"change","change":{"phase":"exploded"}}'),
    ]) {
      final m = decodeSavedMessage(s, id: 1);
      expect(m.unsupported, isTrue, reason: s.clientId);
      expect(m.text, '本文');
      expect(m.change, isNull);
      expect(m.tidy, isNull);
    }
  });

  test('256KB を超える片付けの一覧は、選んだ・削除に出た候補だけに間引かれる', () {
    final items = [
      for (var i = 0; i < 500; i++) TidyItem(id: '$i', title: 'あ' * 200, status: 'cancelled'),
    ];
    final saved = encodeRapiMessage(
      RapiMessage(
        id: 1,
        role: RapiRole.assistant,
        tidy: RapiTidyCard(text: 'x', phase: RapiTidyPhase.listing, items: items, chosen: const {'3', '4'}),
      ),
      clientId: 'c',
    )!;
    expect(utf8.encode(saved.payload!).length, lessThanOrEqualTo(rapiSnapshotMaxBytes));
    final body = (jsonDecode(saved.payload!) as Map)['tidy'] as Map;
    expect((body['items'] as List).map((i) => (i as Map)['id']), ['3', '4']);
    expect(body['itemsOmitted'], 498);
    expect(saved.kind, 'tidy');
  });

  test('保存しない行：相談・タスク選び・下書き・挨拶・ショートカットの案内・端末だけの案内', () {
    final skip = [
      const RapiMessage(id: 1, role: RapiRole.user, text: '相談', consultTaskId: '5'),
      const RapiMessage(id: 2, role: RapiRole.assistant, consultPicker: RapiConsultPicker(text: 'x', utteranceId: 1)),
      const RapiMessage(id: 3, role: RapiRole.assistant, draftSlot: true),
      const RapiMessage(id: 4, role: RapiRole.system, text: '依頼を入れました', externalDraftId: 'e1'),
      const RapiMessage(id: 5, role: RapiRole.assistant, text: '挨拶', localOnly: true),
    ];
    for (final m in skip) {
      expect(encodeRapiMessage(m, clientId: 'x'), isNull, reason: '${m.id}');
    }
    expect(encodeRapiMessage(const RapiMessage(id: 6, role: RapiRole.user, text: 'ふつう'), clientId: 'x'),
        isNotNull);
  });
}
