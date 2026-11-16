import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';

/// GET のクエリを記録して空の一覧を返す ApiClient。
class _RecordingClient implements ApiClient {
  final List<({String path, Map<String, dynamic>? query})> getCalls = [];

  @override
  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    getCalls.add((path: path, query: queryParameters));
    return Response<T>(
      data: {'ideas': <dynamic>[], 'total': 0} as T,
      statusCode: 200,
      requestOptions: RequestOptions(path: path),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('BacklogService.getIdeas のクエリ', () {
    late _RecordingClient client;
    late BacklogService service;

    setUp(() {
      client = _RecordingClient();
      service = BacklogService(client);
    });

    test('条件なしは改修前と同じ（先頭100件のみ・status を送らない）', () async {
      await service.getIdeas();
      expect(client.getCalls.single.path, '/idea-box');
      expect(client.getCalls.single.query, {'limit': '100', 'offset': '0'});
    });

    test('指定した条件だけを載せる', () async {
      await service.getIdeas(themeId: '7', priority: 'high', status: 'used', search: 'ポモドーロ');
      expect(client.getCalls.single.query, {
        'limit': '100',
        'offset': '0',
        'themeId': '7',
        'priority': 'high',
        'status': 'used',
        'search': 'ポモドーロ',
      });
    });

    test('各条件は単独でも載る', () async {
      await service.getIdeas(themeId: '3');
      await service.getIdeas(priority: 'urgent');
      await service.getIdeas(status: 'open');
      await service.getIdeas(search: 'x');
      final queries = client.getCalls.map((c) => c.query).toList();
      expect(queries[0], containsPair('themeId', '3'));
      expect(queries[1], containsPair('priority', 'urgent'));
      expect(queries[2], containsPair('status', 'open'));
      expect(queries[3], containsPair('search', 'x'));
      for (final q in queries) {
        expect(q!.length, 3, reason: 'limit・offset と指定した1条件だけ: $q');
      }
    });

    test('空文字の条件は送らない', () async {
      await service.getIdeas(themeId: '', priority: '', status: '', search: '');
      expect(client.getCalls.single.query, {'limit': '100', 'offset': '0'});
    });
  });
}
