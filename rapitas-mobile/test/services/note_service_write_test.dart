import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/note_service.dart';

// NoteService の書き込み API 契約（rapitas-backend routes/memory/notes.routes.ts）を固定する。
// - PUT /notes/:id は送ったフィールドだけを書く upsert。モバイルはタイトルと本文だけを送る
// - POST /notes/:id/links の taskId は数値（linkBody: t.Number()）、meta は themeName/projectName/parentTaskTitle
// - DELETE /notes/:id

class _Call {
  final String method;
  final String path;
  final Object? data;

  _Call(this.method, this.path, this.data);
}

/// PUT・POST・DELETE を記録し、[handler] の返す本文（または例外）を返す ApiClient。
class _RecordingClient implements ApiClient {
  final List<_Call> calls = [];
  final Object? Function(_Call call) handler;

  _RecordingClient(this.handler);

  Future<Response<T>> _respond<T>(_Call call) async {
    calls.add(call);
    final data = handler(call);
    if (data is DioException) throw data;
    return Response<T>(data: data as T, statusCode: 200, requestOptions: RequestOptions(path: call.path));
  }

  @override
  Future<Response<T>> put<T>(String path, {dynamic data}) => _respond(_Call('PUT', path, data));

  @override
  Future<Response<T>> post<T>(String path,
          {dynamic data, Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) =>
      _respond(_Call('POST', path, data));

  @override
  Future<Response<T>> delete<T>(String path) => _respond(_Call('DELETE', path, null));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

DioException _status(String path, int code) {
  final options = RequestOptions(path: path);
  return DioException(
    requestOptions: options,
    type: DioExceptionType.badResponse,
    response: Response(requestOptions: options, statusCode: code, data: {'success': false}),
  );
}

/// saveNote の戻り（NoteRecord を JSON にしたもの）
Map<String, dynamic> _saved(String id, {String title = 'T', String content = 'C', List<int> linked = const []}) => {
      'success': true,
      'note': {
        'id': id,
        'title': title,
        'content': content,
        'isPinned': false,
        'tags': <String>[],
        'createdAt': '2026-11-13T01:00:00.000Z',
        'updatedAt': '2026-11-13T01:00:00.000Z',
        'linkedTaskIds': linked,
        'linkedTaskMeta': <String, dynamic>{},
      },
    };

void main() {
  group('NoteService.saveNote（PUT /notes/:id）', () {
    test('PUT /notes/:id にタイトルと本文だけを送り、保存後のノートを読む', () async {
      final client = _RecordingClient((c) => _saved('1731456000000', title: '設計メモ', content: '# 本文', linked: [12]));
      final note = await NoteService(client).saveNote('1731456000000', title: '設計メモ', content: '# 本文');

      expect(client.calls.single.method, 'PUT');
      expect(client.calls.single.path, '/notes/1731456000000');
      // 種類・色・タグ・ピン留めを送らない（送るとデスクトップで付けた値を上書きする）
      expect(client.calls.single.data, {'title': '設計メモ', 'content': '# 本文'});
      expect(note.id, '1731456000000');
      expect(note.title, '設計メモ');
      expect(note.linkedTaskIds, ['12']);
    });

    test('null の引数は送らない（部分更新）', () async {
      final client = _RecordingClient((c) => _saved('n1'));
      await NoteService(client).saveNote('n1', content: '本文だけ');
      expect(client.calls.single.data, {'content': '本文だけ'});
    });

    test('id はパスに入れる前に符号化する', () async {
      final client = _RecordingClient((c) => _saved('a/b'));
      await NoteService(client).saveNote('a/b', title: 'x');
      expect(client.calls.single.path, '/notes/a%2Fb');
    });

    test('通信の失敗はそのまま投げる', () async {
      final client = _RecordingClient((c) => _status(c.path, 500));
      expect(() => NoteService(client).saveNote('n1', title: 'x'), throwsA(isA<DioException>()));
    });
  });

  group('NoteService.linkNote（POST /notes/:id/links）', () {
    test('taskId を数値にして送り、テーマ名があれば meta に入れる', () async {
      final client = _RecordingClient((c) => {'success': true});
      await NoteService(client).linkNote('n1', '42', themeName: 'rapitas');

      expect(client.calls.single.method, 'POST');
      expect(client.calls.single.path, '/notes/n1/links');
      final data = client.calls.single.data as Map;
      expect(data['taskId'], 42);
      expect(data['taskId'], isA<int>());
      expect(data['meta'], {'themeName': 'rapitas'});
    });

    test('テーマ名が無ければ meta を送らない', () async {
      final client = _RecordingClient((c) => {'success': true});
      await NoteService(client).linkNote('n1', '42');
      expect(client.calls.single.data, {'taskId': 42});
    });

    test('ノートが無い（404）などの失敗は投げる', () async {
      final client = _RecordingClient((c) => _status(c.path, 404));
      expect(() => NoteService(client).linkNote('n1', '42'), throwsA(isA<DioException>()));
    });
  });

  group('NoteService.deleteNote（DELETE /notes/:id）', () {
    test('DELETE /notes/:id を呼ぶ', () async {
      final client = _RecordingClient((c) => {'success': true});
      await NoteService(client).deleteNote('n1');
      expect(client.calls.single.method, 'DELETE');
      expect(client.calls.single.path, '/notes/n1');
    });

    test('既に無い（404）なら消えたものとして扱う', () async {
      final client = _RecordingClient((c) => _status(c.path, 404));
      await NoteService(client).deleteNote('n1');
    });

    test('404 以外の失敗は投げる', () async {
      final client = _RecordingClient((c) => _status(c.path, 500));
      expect(() => NoteService(client).deleteNote('n1'), throwsA(isA<DioException>()));
    });
  });

  test('newNoteId はデスクトップと同じミリ秒の文字列', () {
    final at = DateTime.utc(2026, 11, 13, 1, 2, 3, 456);
    expect(NoteService.newNoteId(at), '${at.millisecondsSinceEpoch}');
    expect(RegExp(r'^\d+$').hasMatch(NoteService.newNoteId()), isTrue);
  });
}
