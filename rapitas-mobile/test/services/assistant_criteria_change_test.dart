import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// 既存タスクの完了条件の変更（設計 段E・§7 第2段階 項目3）の API の形。
// 形はバックエンド rapitas-backend/routes/ai/assistant-criteria.routes.ts が正：
//   POST /assistant/criteria-draft {taskId, acceptanceCriteria, reason}（書き込まない）
//   POST /assistant/task-criteria {taskId, confirmed:true, expectedCriteriaRevision, acceptanceCriteria, reason}
//   POST /assistant/task-criteria/revert {actionId}

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


Map<String, dynamic> _draftBody({String? blockedBy}) => {
      'success': true,
      'draft': {
        'taskId': 7,
        'title': 'ログインのバグを直す',
        'criteriaRevision': 'rev-1',
        'proposedRevision': 'rev-2',
        'before': {
          'goals': ['直す'],
          'constraints': <String>[],
          'acceptanceCriteria': ['ログインできる', 'エラーが出る'],
        },
        'after': {
          'goals': ['直す'],
          'constraints': <String>[],
          'acceptanceCriteria': ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる'],
        },
        'reason': '鍵の仕様が決まった',
        'blockedBy': blockedBy,
        if (blockedBy != null) 'blockedMessage': 'いまは陪審が確認中です。',
      },
    };

void main() {
  group('criteria-draft', () {
    test('taskId は数値・条件と理由を送り、下書きの版と差分を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/criteria-draft': [_draftBody()],
      });
      final draft = await AssistantService(client).criteriaDraft('7',
          acceptanceCriteria: ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる'],
          reason: '鍵の仕様が決まった');
      expect(client.bodyOf('/assistant/criteria-draft'), {
        'taskId': 7,
        'acceptanceCriteria': ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる'],
        'reason': '鍵の仕様が決まった',
      });
      expect(draft.criteriaRevision, 'rev-1');
      expect(draft.blockedBy, isNull);
      expect(draft.after, ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる']);
      expect(
          criteriaDiffRows(draft.before, draft.after,
              rewordings: {'エラーが出る': '誤ったパスワードでは案内が出る'}),
          const [
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.reworded,
            before: 'エラーが出る', after: '誤ったパスワードでは案内が出る'),
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.added, after: '3回で鍵がかかる'),
      ]);
    });

    test('判定中なら blockedBy と案内文を読む', () async {
      final client = _RecordingApiClient({
        '/assistant/criteria-draft': [_draftBody(blockedBy: 'review_in_progress')],
      });
      final draft = await AssistantService(client)
          .criteriaDraft('7', acceptanceCriteria: ['a'], reason: 'r');
      expect(draft.blockedBy, 'review_in_progress');
      expect(draft.blockedMessage, 'いまは陪審が確認中です。');
    });
  });

  group('task-criteria（確定）', () {
    Future<RapiCriteriaDraft> draftOf() async => AssistantService(_RecordingApiClient({
          '/assistant/criteria-draft': [_draftBody()],
        })).criteriaDraft('7', acceptanceCriteria: ['x'], reason: 'r');

    test('confirmed と下書きの版、下書きの条件と理由を送る', () async {
      final client = _RecordingApiClient({
        '/assistant/task-criteria': [
          {
            'success': true,
            'actionId': 31,
            'before': {'acceptanceCriteria': ['ログインできる', 'エラーが出る']},
            'after': {'acceptanceCriteria': ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる']},
            'previousRevision': 'rev-1',
            'revision': 'rev-2',
            'reason': '鍵の仕様が決まった',
            'confirmedBy': 'user',
          }
        ],
      });
      final result = await AssistantService(client).criteriaUpdate(await draftOf());
      expect(client.sent.single.$1, '/assistant/task-criteria');
      expect(client.bodyOf('/assistant/task-criteria'), {
        'taskId': 7,
        'confirmed': true,
        'expectedCriteriaRevision': 'rev-1',
        'acceptanceCriteria': ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる'],
        'reason': '鍵の仕様が決まった',
      });
      expect(result.actionId, 31);
      expect(result.after, ['ログインできる', '誤ったパスワードでは案内が出る', '3回で鍵がかかる']);
    });

    test('409 criteria_changed_since は code・状態・案内文つきの例外', () async {
      final client = _RecordingApiClient({
        '/assistant/task-criteria': [
          const _Status(409, {
            'success': false,
            'error': 'criteria_changed_since',
            'message': '完了条件は、この画面を開いたあとで変わっています。',
            'currentRevision': 'rev-9',
          })
        ],
      });
      final err = await AssistantService(client)
          .criteriaUpdate(await draftOf())
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect(err, isA<AssistantException>());
      final e = err as AssistantException;
      expect(e.code, 'criteria_changed_since');
      expect(e.statusCode, 409);
      expect(e.message, '完了条件は、この画面を開いたあとで変わっています。');
    });
  });

  test('revert は actionId だけを送る', () async {
    final client = _RecordingApiClient({
      '/assistant/task-criteria/revert': [
        {
          'success': true,
          'actionId': 32,
          'before': {'acceptanceCriteria': ['b']},
          'after': {'acceptanceCriteria': ['a']},
        }
      ],
    });
    final result = await AssistantService(client).revertCriteria(31);
    expect(client.bodyOf('/assistant/task-criteria/revert'), {'actionId': 31});
    expect(result.actionId, 32);
  });

  group('criteriaDiffRows', () {
    test('鉛筆で直した対だけが言い換え。外した位置に足した条件は、消す・足すのまま', () {
      expect(criteriaDiffRows(['A', 'B', 'C'], ['A', 'B2', 'D'], rewordings: {'B': 'B2'}), const [
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.reworded, before: 'B', after: 'B2'),
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.removed, before: 'C'),
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.added, after: 'D'),
      ]);
      expect(criteriaDiffRows(['A', 'B', 'C'], ['A', 'C']), const [
        RapiCriteriaDiffRow(RapiCriteriaDiffKind.removed, before: 'B'),
      ]);
      expect(criteriaDiffRows(['A'], ['A']), isEmpty);
    });

    test('カードの rewordings は、今の条件の位置で直した文だけを対にする', () {
      var card = RapiCriteriaCard.start(taskId: '7', title: 't', criteria: ['A', 'B', 'C']);
      card = card.copyWith(
          edit: card.edit.rewritten(1, 'B2').toggled(2).appended('D').settled());
      expect(card.rewordings, {'B': 'B2'});
      expect(card.proposed, ['A', 'B2', 'D']);
      expect(card.changed, isTrue);
      expect(card.canDraft, isFalse); // 理由がまだ無い
      expect(card.copyWith(reason: '仕様が決まった').canDraft, isTrue);
    });
  });
}
