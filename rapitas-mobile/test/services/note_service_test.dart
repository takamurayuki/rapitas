import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/note_service.dart';

/// GET のパス・クエリを記録し、[handler] の返す本文（または例外）を返す ApiClient。
class _RecordingClient implements ApiClient {
  final List<({String path, Map<String, dynamic>? query})> getCalls = [];
  final Object? Function(String path) handler;

  _RecordingClient(this.handler);

  @override
  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    getCalls.add((path: path, query: queryParameters));
    final data = handler(path);
    if (data is DioException) throw data;
    return Response<T>(data: data as T, statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

DioException _status(String path, int code, Object body) {
  final options = RequestOptions(path: path);
  return DioException(
    requestOptions: options,
    type: DioExceptionType.badResponse,
    response: Response(requestOptions: options, statusCode: code, data: body),
  );
}

/// rapitas-backend services/notes/note-service.ts の NoteRecord と同じ形（JSON にした後）
Map<String, dynamic> _noteRecord(String id, {List<int> linked = const []}) => {
      'id': id,
      'title': 'ノート$id',
      'content': '# 見出し\n本文',
      'isPinned': id == '1',
      'tags': ['設計', 'v1'],
      'color': null,
      'docType': '設計書',
      'createdAt': '2026-11-12T01:00:00.000Z',
      'updatedAt': '2026-11-13T02:30:00.000Z',
      'linkedTaskIds': linked,
      // Record<number, NoteTaskMeta> は JSON でキーが文字列になる
      'linkedTaskMeta': {
        for (final t in linked) '$t': {'themeName': 'テーマ', 'projectName': 'rapitas'},
      },
    };

void main() {
  group('NoteService.getNotes（GET /notes）', () {
    test('taskId なしは /notes をクエリなしで呼ぶ', () async {
      final client = _RecordingClient((_) => {'success': true, 'notes': <dynamic>[]});
      await NoteService(client).getNotes();
      expect(client.getCalls.single.path, '/notes');
      expect(client.getCalls.single.query, isNull);
    });

    test('taskId はクエリ ?taskId=<id> で送る（バックエンドは文字列で受ける）', () async {
      final client = _RecordingClient((_) => {'success': true, 'notes': <dynamic>[]});
      await NoteService(client).getNotes(taskId: '42');
      expect(client.getCalls.single.path, '/notes');
      expect(client.getCalls.single.query, {'taskId': '42'});
    });

    test('{success, notes} の notes をサーバーの並びのまま読む', () async {
      final client = _RecordingClient((_) => {
            'success': true,
            'notes': [
              _noteRecord('1', linked: [42]),
              _noteRecord('1731400000000'),
            ],
          });
      final notes = await NoteService(client).getNotes(taskId: '42');
      expect(notes.map((n) => n.id), ['1', '1731400000000']);
      final first = notes.first;
      expect(first.title, 'ノート1');
      expect(first.isPinned, isTrue);
      expect(first.tags, ['設計', 'v1']);
      expect(first.docType, '設計書');
      expect(first.color, isNull);
      expect(first.updatedAt, DateTime.utc(2026, 11, 13, 2, 30).toLocal());
      expect(first.linkedTaskIds, ['42']);
      expect(first.linkedTaskMeta['42']?.projectName, 'rapitas');
      expect(first.linkedTaskMeta['42']?.themeName, 'テーマ');
    });

    test('notes が無い・形が違う応答は空の一覧', () async {
      final client = _RecordingClient((_) => {'success': true});
      expect(await NoteService(client).getNotes(), isEmpty);
    });
  });

  group('NoteService.getNote（GET /notes/:id）', () {
    test('{success, note} の note を読む', () async {
      final client = _RecordingClient((_) => {'success': true, 'note': _noteRecord('7', linked: [3, 9])});
      final note = await NoteService(client).getNote('7');
      expect(client.getCalls.single.path, '/notes/7');
      expect(note?.id, '7');
      expect(note?.linkedTaskIds, ['3', '9']);
    });

    test('id はパスに入れるとき符号化する（文字列 id のまま扱う）', () async {
      final client = _RecordingClient((_) => {'success': true, 'note': _noteRecord('a/b c')});
      await NoteService(client).getNote('a/b c');
      expect(client.getCalls.single.path, '/notes/a%2Fb%20c');
    });

    test('404 note_not_found は null', () async {
      final client = _RecordingClient(
          (path) => _status(path, 404, {'success': false, 'error': 'note_not_found'}));
      expect(await NoteService(client).getNote('missing'), isNull);
    });

    test('404 以外の失敗はそのまま投げる', () async {
      final client = _RecordingClient((path) => _status(path, 500, {'success': false}));
      expect(NoteService(client).getNote('7'), throwsA(isA<DioException>()));
    });
  });
}
