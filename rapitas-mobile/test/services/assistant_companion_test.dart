import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// 伴走（companion）の API の形と、完了条件の見せ方（段B）の読み取り。
// 形はバックエンド rapitas-backend/routes/ai/assistant-companion.routes.ts・
// assistant-intake.routes.ts（task-draft）・services/assistant/criteria-proposal.ts が正。

/// 送ったボディを記録し、パスごとに決まった応答を返す ApiClient。
/// 応答が [_Status] なら、その状態コードの badResponse（Dio の既定の validateStatus と同じ）を投げる。
class _RecordingApiClient implements ApiClient {
  final Map<String, List<Object>> responses;
  final List<(String, dynamic)> sent = [];

  _RecordingApiClient(this.responses);

  Response<T> _respond<T>(String path, dynamic data) {
    sent.add((path, data));
    final queue = responses[path];
    if (queue == null || queue.isEmpty) throw StateError('想定外のリクエスト: $path');
    final value = queue.length > 1 ? queue.removeAt(0) : queue.first;
    final options = RequestOptions(path: path);
    if (value is _Status) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(
            data: value.body, statusCode: value.code, requestOptions: options),
      );
    }
    if (value is DioException) throw value;
    return Response<T>(data: value as T?, statusCode: 200, requestOptions: options);
  }

  @override
  Future<Response<T>> get<T>(String path,
          {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async =>
      _respond<T>(path, null);

  @override
  Future<Response<T>> post<T>(String path,
          {dynamic data,
          Map<String, dynamic>? queryParameters,
          Duration? receiveTimeout}) async =>
      _respond<T>(path, data);

  @override
  Future<Response<T>> patch<T>(String path, {dynamic data}) async => _respond<T>(path, data);

  @override
  Future<Response<T>> put<T>(String path, {dynamic data}) async => _respond<T>(path, data);

  @override
  Future<Response<T>> delete<T>(String path) async => _respond<T>(path, null);

  @override
  void updateBaseUrl(String baseUrl) {}

  dynamic bodyOf(String path) => sent.lastWhere((s) => s.$1 == path).$2;
}

class _Status {
  final int code;
  final Map<String, dynamic> body;
  const _Status(this.code, this.body);
}

void main() {
  group('companion/draft', () {
    test('taskId は数値で送り、提案を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/companion/draft': [
          {
            'success': true,
            'matched': true,
            'action': 'start',
            'proposal': {'action': 'start', 'taskId': 7, 'title': 'ログイン', 'active': false},
          },
        ],
      });
      final draft = await AssistantService(client).companionDraft('伴走して', taskId: '7');
      expect(client.bodyOf('/assistant/companion/draft'), {'text': '伴走して', 'taskId': 7});
      expect(draft.matched, isTrue);
      expect(draft.action, RapiCompanionAction.start);
      expect(draft.proposal?.taskId, '7');
      expect(draft.proposal?.title, 'ログイン');
      expect(draft.unavailable, isNull);
    });

    test('対象なしは needsTask、依頼でなければ matched:false、理由は unavailable', () async {
      final client = _RecordingApiClient({
        '/assistant/companion/draft': [
          {'success': true, 'matched': true, 'action': 'stop', 'needsTask': true},
          {'success': true, 'matched': false},
          {
            'success': true,
            'matched': true,
            'action': 'stop',
            'unavailable': 'not_active',
            'proposal': {'action': 'stop', 'taskId': 9, 'title': 't', 'active': false},
          },
        ],
      });
      final s = AssistantService(client);
      final a = await s.companionDraft('伴走をやめて');
      expect(client.bodyOf('/assistant/companion/draft'), {'text': '伴走をやめて'});
      expect((a.matched, a.needsTask, a.action), (true, true, RapiCompanionAction.stop));
      expect((await s.companionDraft('伴走って？')).matched, isFalse);
      expect((await s.companionDraft('伴走をやめて', taskId: '9')).unavailable, 'not_active');
    });

    test('向きの読めない応答は依頼として扱わない', () {
      expect(RapiCompanionDraft.fromJson({'matched': true, 'action': 'pause'}).matched, isFalse);
    });
  });

  group('companion start/stop', () {
    test('confirmed: true で向きどおりのパスへ送る', () async {
      final client = _RecordingApiClient({
        '/assistant/companion/start': [
          {'success': true, 'outcome': 'started', 'actionId': 1},
        ],
        '/assistant/companion/stop': [
          {'success': true, 'actionId': 2},
        ],
      });
      final s = AssistantService(client);
      await s.companionApply(RapiCompanionAction.start, '7');
      await s.companionApply(RapiCompanionAction.stop, '7');
      expect(client.bodyOf('/assistant/companion/start'), {'taskId': 7, 'confirmed': true});
      expect(client.bodyOf('/assistant/companion/stop'), {'taskId': 7, 'confirmed': true});
    });

    test('409 はその code と状態の AssistantException', () async {
      final client = _RecordingApiClient({
        '/assistant/companion/start': [
          const _Status(409, {'success': false, 'error': 'already_active'}),
        ],
      });
      await expectLater(
        AssistantService(client).companionApply(RapiCompanionAction.start, '7'),
        throwsA(isA<AssistantException>()
            .having((e) => e.code, 'code', 'already_active')
            .having((e) => e.statusCode, 'statusCode', 409)),
      );
    });
  });

  group('完了条件の見せ方（段B）', () {
    test('task-draft の項目と採点を読む。項目が無い古い応答は文だけで並べる', () {
      final draft = TaskDraft.fromJson({
        'title': 't',
        'acceptanceCriteria': ['a', 'b'],
        'acceptanceCriteriaItems': [
          {'text': 'a', 'verifier': 'jury', 'vague': {'term': '速い', 'suggestion': '秒で書く'}},
          {'text': 'b', 'verifier': 'user', 'supplemented': true},
        ],
        'criteriaQuality': {'score': 80, 'isAdequate': true, 'vagueCount': 1, 'reasons': ['x']},
      });
      expect(draft.criteriaRows.map((i) => i.verifierLabel), ['陪審が確かめる', '本人が確かめる']);
      expect(draft.criteriaRows.first.vagueTerm, '速い');
      expect(draft.criteriaRows.last.supplemented, isTrue);
      expect(draft.criteriaQuality?.score, 80);

      final old = TaskDraft.fromJson({'title': 't', 'acceptanceCriteria': ['a']});
      expect(old.criteriaRows.single.text, 'a');
      expect(old.criteriaQuality, isNull);
    });

    test('計画の手順は criteriaItems を読むが、commit では送らない', () {
      final step = RoadmapStep.fromJson({
        'title': 's',
        'description': 'd',
        'acceptanceCriteria': ['a'],
        'criteriaItems': [
          {'text': 'a', 'verifier': 'user'},
        ],
      });
      expect(step.criteriaItems.single.verifier, RapiCriterionVerifier.user);
      expect(step.toJson().containsKey('criteriaItems'), isFalse);
    });
  });
}
