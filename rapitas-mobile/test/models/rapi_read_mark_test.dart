import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_chat_message.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_read_mark.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_decode.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';

// 読み込んだ記録への確認の印の戻し方（rapiRestoreReadMarks）と、保存形式を変えていないこと。

void main() {
  var n = 0;
  RapiMessage row(String role, String text,
          {bool inHistory = false, String kind = 'text', String? payload, int? taskId}) =>
      decodeSavedMessage(
          SavedMessage(
              clientId: 'c${n++}',
              role: role,
              kind: kind,
              text: text,
              inHistory: inHistory,
              payload: payload,
              taskId: taskId),
          id: n);

  String? readOf(List<RapiMessage> out, String text) =>
      out.firstWhere((m) => m.role == RapiRole.user && m.text == text).readAs;

  test('カードの種類から意図を戻す（案内が無くても）', () {
    final answer = jsonEncode({
      'v': 1,
      'kind': 'answer',
      'answer': {'available': true, 'total': 0, 'rows': [], 'unclear': false},
    });
    final out = rapiRestoreReadMarks([
      row('user', '進行中は？', inHistory: true),
      row('assistant', '', kind: 'answer', payload: answer),
      row('user', '片付けて', inHistory: true),
      row('assistant', '', kind: 'tidy', payload: '{"broken"'),
    ]);
    expect(readOf(out, '進行中は？'), 'ask');
    // 読めない記録（unsupported）は種類が分からない＝会話として 👌 に倒す
    expect(readOf(out, '片付けて'), 'chat');
    expect(rapiStampGlyphFor(readOf(out, '片付けて')), '👌');
  });

  test('デスクトップが前に保存した案内と英語の案内からも戻す', () {
    final out = rapiRestoreReadMarks([
      row('user', 'a', inHistory: true),
      row('system', '「計画を立てる」として受け取りました — 長い目標'),
      row('user', 'b', inHistory: true),
      row('system', 'Took that as “Needs you” — overview'),
      row('user', 'c', inHistory: true),
      row('system', '伴走の開始として受け取りました'),
    ]);
    expect(readOf(out, 'a'), 'roadmap');
    expect(readOf(out, 'b'), 'watch');
    expect(readOf(out, 'c'), 'companion');
  });

  test('応答が保存されない種類のターンでも、次の発言が続いていれば確認済み（👌）', () {
    final out = rapiRestoreReadMarks([
      row('user', 'デスクトップで振り分けた発言', inHistory: true),
      row('user', '次の発言', inHistory: true),
    ]);
    expect(readOf(out, 'デスクトップで振り分けた発言'), 'chat');
    // 末尾で応答が無いものは付けない
    expect(readOf(out, '次の発言'), isNull);
  });

  test('失敗した発言には戻さない（タイムアウトも同じ。振り分けの案内の後で失敗しても）', () {
    final out = rapiRestoreReadMarks([
      row('user', 'x'),
      row('system', rapiTimeoutMessage),
      row('user', 'y'),
      row('system', 'タスク作成として受け取りました'),
      row('system', rapiSendFailedText),
      row('user', 'z'),
      row('user', 'w', inHistory: true),
    ]);
    expect(readOf(out, 'x'), isNull);
    expect(readOf(out, 'y'), isNull);
    // 履歴から外れた（取り消された）発言は、次の発言があっても付けない
    expect(readOf(out, 'z'), isNull);
  });

  test('いまのセッションの行と、印のある行は変えない', () {
    const live = RapiMessage(id: 1, role: RapiRole.user, text: '送信中', inHistory: true);
    final marked = row('user', '既に印', inHistory: true).withReadAs('create');
    final out = rapiRestoreReadMarks([
      live,
      const RapiMessage(id: 2, role: RapiRole.assistant, text: '返答'),
      marked,
      row('assistant', '返答'),
    ]);
    expect(out[0].readAs, isNull);
    expect(out[2].readAs, 'create');
  });

  test('保存形式は変えない：印のある発言も、印の無い行と同じ項目で保存する', () {
    const plain = RapiMessage(id: 1, role: RapiRole.user, text: 'こんにちは', inHistory: true);
    final read = plain.withReadAs('create');
    final a = encodeRapiMessage(plain, clientId: 'k')!.toJson();
    final b = encodeRapiMessage(read, clientId: 'k')!.toJson();
    expect(b, a);
    expect(b.keys, isNot(contains('readAs')));
  });

  test('withId・withoutHistory は印を保ち、withReadAs(null) で外れる', () {
    final m = const RapiMessage(id: 1, role: RapiRole.user, text: 't').withReadAs('watch');
    expect(m.withId(9).readAs, 'watch');
    expect(m.withoutHistory().readAs, 'watch');
    expect(m.withReadAs(null).readAs, isNull);
  });
}
