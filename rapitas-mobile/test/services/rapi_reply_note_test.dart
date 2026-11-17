import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_chat_message.dart';
import 'package:rapitas_mobile/services/rapi_reply_note.dart';

import '../support/note_fakes.dart';

// ラピの返答から作るノートの中身（タイトル・本文）と、保存（PUT）・紐付け（POST links）の流れ。

void main() {
  group('buildRapiReplyNote', () {
    test('タイトルは質問の1行目、本文は質問とラピの回答の両方を Markdown で残す', () {
      final note = buildRapiReplyNote('ログインのバグはどこから調べる？\n補足です', '- まずログを見る\n- **再現手順**を書く');
      expect(note.title, 'ログインのバグはどこから調べる？');
      expect(
        note.content,
        '## 質問\n\nログインのバグはどこから調べる？\n補足です\n\n## ラピの回答\n\n- まずログを見る\n- **再現手順**を書く\n',
      );
    });

    test('長い質問は30字で「…」を付けて切る', () {
      expect(buildRapiReplyNote('あ' * 40, '答え').title, '${'あ' * 30}…');
      expect(buildRapiReplyNote('あ' * 30, '答え').title, 'あ' * 30);
    });

    test('質問が無ければ返答の1行目（記号を落とす）、それも無ければ「ラピとの会話」', () {
      expect(buildRapiReplyNote(null, '## 今週の進め方\n本文').title, '今週の進め方');
      expect(buildRapiReplyNote(null, '## 今週の進め方').content, '## ラピの回答\n\n## 今週の進め方\n');
      expect(buildRapiReplyNote('  ', ' ').title, 'ラピとの会話');
    });
  });

  group('rapiQuestionBefore', () {
    RapiMessage m(int id, RapiRole role, String text, [String? task]) =>
        RapiMessage(id: id, role: role, text: text, consultTaskId: task);

    test('同じ会話の中で直前のユーザーの発言を取る（相談と一般を混ぜない）', () {
      final lines = [
        m(0, RapiRole.assistant, '挨拶'),
        m(1, RapiRole.user, '一般の質問'),
        m(2, RapiRole.assistant, '一般の答え'),
        m(3, RapiRole.user, '相談の質問', '7'),
        m(4, RapiRole.system, '案内'),
        m(5, RapiRole.assistant, '相談の答え', '7'),
      ];
      expect(rapiQuestionBefore(lines, lines[5]), '相談の質問');
      expect(rapiQuestionBefore(lines, lines[2]), '一般の質問');
      expect(rapiQuestionBefore(lines, lines[0]), isNull);
    });
  });

  group('saveRapiReplyNote', () {
    const draft = RapiReplyNoteDraft(title: 'タイトル', content: '## ラピの回答\n\n答え\n');
    final now = DateTime.fromMillisecondsSinceEpoch(1731800000000);

    test('タイトルと本文で保存し、タスクがあれば紐付ける', () async {
      final service = FakeNoteService();
      final saved = await saveRapiReplyNote(service, draft, taskId: '7', now: now);
      expect(saved.noteId, '1731800000000');
      expect(saved.linked, isTrue);
      expect(service.calls, [
        'save:1731800000000:タイトル:## ラピの回答\n\n答え\n',
        'link:1731800000000:7:null',
      ]);
    });

    test('タスクが無ければ紐付けない', () async {
      final service = FakeNoteService();
      final saved = await saveRapiReplyNote(service, draft, now: now);
      expect(saved.linked, isNull);
      expect(service.calls, ['save:1731800000000:タイトル:## ラピの回答\n\n答え\n']);
    });

    test('紐付けだけ失敗したら、保存は成功のまま linked=false', () async {
      final service = FakeNoteService()..failLink = true;
      final saved = await saveRapiReplyNote(service, draft, taskId: '7', now: now);
      expect(saved.linked, isFalse);
    });

    test('ノートの保存が失敗したら投げ、紐付けもしない', () async {
      final service = FakeNoteService()..failSave = true;
      await expectLater(saveRapiReplyNote(service, draft, taskId: '7', now: now), throwsException);
      expect(service.calls.where((c) => c.startsWith('link:')), isEmpty);
    });
  });
}
