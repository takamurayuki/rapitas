import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_space_fakes.dart';
import '../support/rapi_space_harness.dart';

// 完了条件の変更カードと会話スペース（nav42 バッチB の rebase 移植）：
// 直している途中は保存しない・確定の応答待ちはすぐ保存し、断られたら消す・確定後を保存する・
// 読み込んだ記録のカードからは、どの操作も効かない（書き込みも状態の変化も起きない）。

const _base = ['ログインできる', 'エラーが出る'];
const _last = 'rapiLastSpaceId.v1:http://localhost:3001';

Task _task(String id) => Task(
      id: id,
      title: 'ログインのバグを直す',
      status: 'in-progress',
      priority: 'medium',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 8),
      acceptanceCriteria: _base,
    );

/// 下書きは返し、確定は [gate] が開くまで待ってから [outcome] を返す（または投げる）
class _CriteriaAssistant extends FakeAssistant {
  Completer<void>? gate;
  Object? fail;

  @override
  Future<RapiCriteriaDraft> criteriaDraft(String taskId,
          {required List<String> acceptanceCriteria, required String reason}) async =>
      RapiCriteriaDraft(
        taskId: taskId,
        title: 'ログインのバグを直す',
        criteriaRevision: 'r1',
        before: _base,
        after: acceptanceCriteria,
        reason: reason,
      );

  @override
  Future<RapiCriteriaChangeResult> criteriaUpdate(RapiCriteriaDraft draft) async {
    writes.add('criteriaUpdate');
    if (gate != null) await gate!.future;
    if (fail != null) throw fail!;
    return RapiCriteriaChangeResult(actionId: 31, before: draft.before, after: draft.after);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeSpaceServer server;
  late Map<String, String> prefs;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    server = FakeSpaceServer();
    prefs = {};
  });

  Future<(SpaceApp, int)> openAndDraft(_CriteriaAssistant assistant) async {
    final app = await SpaceApp(server, prefs,
        assistant: assistant,
        extra: [taskDetailProvider.overrideWith((ref, id) async => _task(id))]).start();
    await app.say('はじめに');
    await app.chat.openCriteriaChange('7', 'ログインのバグを直す');
    final id = app.chatState.messages.lastWhere((m) => m.criteria != null).id;
    app.chat.editCriteriaItem(id, 1, 'エラー文が日本語で出る');
    app.chat.setCriteriaReason(id, '仕様が決まった');
    await app.chat.draftCriteriaChange(id);
    await app.settle();
    return (app, id);
  }

  List<String> kinds(FakeSpace s) => [for (final r in s.rows) r.kind];

  test('直している途中・下書きの確認中は保存せず、確定したカードを criteria として保存する', () async {
    final assistant = _CriteriaAssistant();
    final (app, id) = await openAndDraft(assistant);
    final space = server.spaces.values.single;
    expect(app.chatState.messages.firstWhere((m) => m.id == id).criteria!.phase, RapiCriteriaPhase.proposed);
    expect(kinds(space), isNot(contains('criteria')), reason: '途中のカードは保存しない');

    await app.chat.applyCriteriaChange(id);
    await app.settle();
    final row = space.rows.singleWhere((r) => r.kind == 'criteria');
    final body = (jsonDecode(row.payload!) as Map)['criteria'] as Map;
    expect(body['phase'], 'applied');
    expect((body['result'] as Map)['actionId'], 31);
    expect(body['rewordings'], {'エラーが出る': 'エラー文が日本語で出る'});
    app.dispose();
  });

  test('確定の応答待ちはすぐ保存し、断られて下書きの確認に戻ったら、その行を消す', () async {
    final assistant = _CriteriaAssistant()..gate = Completer<void>();
    final (app, id) = await openAndDraft(assistant);
    final space = server.spaces.values.single;

    final applying = app.chat.applyCriteriaChange(id);
    await app.settle();
    final row = space.rows.singleWhere((r) => r.kind == 'criteria');
    expect(((jsonDecode(row.payload!) as Map)['criteria'] as Map)['phase'], 'applying');

    assistant.fail = const AssistantException('criteria_changed_since', statusCode: 409);
    assistant.gate!.complete();
    await applying;
    await app.settle();
    expect(app.chatState.messages.firstWhere((m) => m.id == id).criteria!.phase, RapiCriteriaPhase.proposed);
    expect(kinds(space), isNot(contains('criteria')), reason: '断られたカードの応答待ちの行は残さない');
    app.dispose();
  });

  test('読み込んだ記録のカードからは、確定・取り消し・編集・やめる・作り直す のどれも効かない', () async {
    final s = server.seed(title: '記録');
    final start = RapiCriteriaCard.start(taskId: '7', title: 'ログインのバグを直す', criteria: _base);
    for (final (i, card) in [
      start.copyWith(
          phase: RapiCriteriaPhase.applied,
          result: const RapiCriteriaChangeResult(actionId: 31, before: _base, after: ['ログインできる'])),
      start.copyWith(
          phase: RapiCriteriaPhase.applied,
          refusal: 'criteria_changed_since',
          result: const RapiCriteriaChangeResult(actionId: 32, before: _base, after: ['ログインできる'])),
      start.copyWith(phase: RapiCriteriaPhase.applying),
    ].indexed) {
      server.addRow(
          s, encodeRapiMessage(RapiMessage(id: i, role: RapiRole.assistant, criteria: card), clientId: 'card$i')!);
    }
    prefs[_last] = 'space:${s.id}';
    final app = await SpaceApp(server, prefs).start();
    final cards = [for (final m in app.chatState.messages) if (m.criteria != null) m];
    expect(cards, hasLength(3));
    expect(cards.every((m) => m.archived), isTrue);
    expect(cards.last.criteria!.phase, RapiCriteriaPhase.applyUnknown);
    expect(app.chat.busyForSwitch, isFalse, reason: '記録の応答待ちは処理中に数えない');

    final before = app.chatState.messages;
    for (final m in cards) {
      await app.chat.revertCriteriaChange(m.id);
      await app.chat.applyCriteriaChange(m.id);
      await app.chat.draftCriteriaChange(m.id);
      await app.chat.rebuildCriteriaChange(m.id);
      app.chat.toggleCriteriaItem(m.id, 0);
      app.chat.editCriteriaItem(m.id, 0, '別の文');
      app.chat.addCriteriaItem(m.id, '足す');
      app.chat.setCriteriaReason(m.id, '理由');
      app.chat.backToCriteriaEdit(m.id);
      app.chat.cancelCriteriaChange(m.id);
    }
    await app.settle();
    expect(identical(app.chatState.messages, before), isTrue);
    expect(app.assistant.writes, isEmpty);
    app.dispose();
  });
}
