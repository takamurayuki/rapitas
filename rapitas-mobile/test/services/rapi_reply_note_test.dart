import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/api_config.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/note_service.dart';
import 'package:rapitas_mobile/services/rapi_reply_note.dart';

import '../support/note_fakes.dart';

// ラピの返答をノートにする流れ：下書きの生成（回答だけを送る）→ 保存（PUT）→ 紐付け（POST links）。
// 下書きが作れなければ保存しない（nav70）。

/// 送った要求を記録し、決めた応答を返す ApiClient（NoteService.draftFromReply の確認用）
class _RecordingClient extends ApiClient {
  final List<RequestOptions> requests = [];
  final Object? Function(RequestOptions) reply;

  _RecordingClient(this.reply) : super(config: ApiConfig(baseUrl: 'http://local'));

  @override
  Future<Response<T>> post<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    final options = RequestOptions(path: path, data: data, receiveTimeout: receiveTimeout);
    requests.add(options);
    final body = reply(options);
    if (body is DioException) throw body;
    return Response<T>(requestOptions: options, data: body as T, statusCode: 200);
  }
}

void main() {
  group('NoteService.draftFromReply', () {
    test('回答だけを POST /notes/draft-from-reply に送り、タイトルと本文を読む', () async {
      final client = _RecordingClient(
          (_) => {'success': true, 'title': 'ログイン不具合の調べ方', 'content': '## 手順\n\n- ログを見る\n'});
      final draft = await NoteService(client).draftFromReply('まずログを見ます。');
      expect(draft.title, 'ログイン不具合の調べ方');
      expect(draft.content, '## 手順\n\n- ログを見る\n');
      expect(client.requests.single.path, '/notes/draft-from-reply');
      expect(client.requests.single.data, {'answer': 'まずログを見ます。'});
      expect(client.requests.single.receiveTimeout, NoteService.draftReceiveTimeout);
    });

    test('本文の無い応答は読めないとして投げる', () async {
      final client = _RecordingClient((_) => {'success': true, 'title': 't', 'content': ' '});
      await expectLater(NoteService(client).draftFromReply('答え'), throwsStateError);
    });

    test('サーバーの失敗（502）はそのまま投げる', () async {
      final client = _RecordingClient((o) => DioException(
            requestOptions: o,
            response: Response(requestOptions: o, statusCode: 502, data: {'success': false}),
            type: DioExceptionType.badResponse,
          ));
      await expectLater(NoteService(client).draftFromReply('答え'), throwsA(isA<DioException>()));
    });
  });

  group('saveRapiReplyNote', () {
    final now = DateTime.fromMillisecondsSinceEpoch(1731800000000);
    FakeNoteService service() => FakeNoteService()
      ..draft = const NoteDraft(title: 'ログイン不具合の調べ方', content: '## 手順\n\n- ログを見る\n');

    test('回答から下書きを作り、生成されたタイトルと本文で保存し、タスクがあれば紐付ける', () async {
      final notes = service();
      final saved = await saveRapiReplyNote(notes, 'まずログを見ます。', taskId: '7', now: now);
      expect(saved.noteId, '1731800000000');
      expect(saved.linked, isTrue);
      expect(notes.calls, [
        'draft:まずログを見ます。',
        'save:1731800000000:ログイン不具合の調べ方:## 手順\n\n- ログを見る\n',
        'link:1731800000000:7:null',
      ]);
    });

    test('保存する本文に質問や「ラピの回答」の枠は入らない', () async {
      final notes = service();
      await saveRapiReplyNote(notes, 'まずログを見ます。', now: now);
      final save = notes.calls.singleWhere((c) => c.startsWith('save:'));
      expect(save, isNot(contains('## 質問')));
      expect(save, isNot(contains('## ラピの回答')));
    });

    test('タスクが無ければ紐付けない', () async {
      final notes = service();
      final saved = await saveRapiReplyNote(notes, '答え', now: now);
      expect(saved.linked, isNull);
      expect(notes.calls.where((c) => c.startsWith('link:')), isEmpty);
    });

    test('紐付けだけ失敗したら、保存は成功のまま linked=false', () async {
      final notes = service()..failLink = true;
      final saved = await saveRapiReplyNote(notes, '答え', taskId: '7', now: now);
      expect(saved.linked, isFalse);
    });

    test('下書きが作れなければ投げ、保存も紐付けもしない', () async {
      final notes = service()..failDraft = true;
      await expectLater(saveRapiReplyNote(notes, '答え', taskId: '7', now: now), throwsException);
      expect(notes.calls, ['draft:答え']);
    });

    test('ノートの保存が失敗したら投げ、紐付けもしない', () async {
      final notes = service()..failSave = true;
      await expectLater(saveRapiReplyNote(notes, '答え', taskId: '7', now: now), throwsException);
      expect(notes.calls.where((c) => c.startsWith('link:')), isEmpty);
    });
  });
}
