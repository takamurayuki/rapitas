import 'api_client.dart';
import '../models/rapi.dart';

/// ラピ（/assistant/*）と会話（/copilot/chat）の API。
///
/// ラピは「ユーザーがやること／ラピがやること」の境界を守るエージェントで、
/// その境界は専用 API の側にある（下書きは何も作らない・作成は confirmed 必須・
/// テーマは推測で埋めない）。ここでは汎用化せず API をそのまま写す。
class AssistantService {
  final ApiClient _client;

  AssistantService(this._client);

  static Map<String, dynamic> _body(dynamic data) {
    if (data is Map) return Map<String, dynamic>.from(data);
    throw const AssistantException('unexpected_response');
  }

  /// 文の振り分け先を聞く。振り分けられなければ intent が null。
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    final response = await _client.post(
      '/assistant/route',
      data: {'text': text, 'hasOpenTask': hasOpenTask},
    );
    return RoutedIntent.fromJson(_body(response.data));
  }

  /// 文から下書きを作る（何も作成しない）。
  Future<TaskDraft> createDraft(String text) async {
    final body = _body((await _client.post(
      '/assistant/task-draft',
      data: {'text': text},
    ))
        .data);
    final draft = body['draft'];
    if (draft is! Map) throw const AssistantException('no_draft');
    return TaskDraft.fromJson(
      Map<String, dynamic>.from(draft),
      source: body['source'] is String ? body['source'] as String : null,
    );
  }

  /// ユーザーが確認した下書きからタスクを作る。作成されたタスクの ID を返す。
  ///
  /// NOTE: バックエンドは themeId を Number で必須にしている（t.Number()）。
  /// テーマはユーザーが選んだものだけを渡す（推測で埋めない）。
  Future<String?> createTask({
    required String title,
    required String themeId,
    String? description,
    String? priority,
    String? dueDate,
    double? estimatedHours,
    List<String> acceptanceCriteria = const [],
  }) async {
    final theme = int.tryParse(themeId);
    if (theme == null) throw const AssistantException('invalid_theme');
    final body = _body((await _client.post(
      '/assistant/task-create',
      data: {
        'confirmed': true,
        'task': {
          'title': title,
          'themeId': theme,
          if (description != null && description.isNotEmpty) 'description': description,
          if (priority != null) 'priority': priority,
          if (dueDate != null) 'dueDate': dueDate,
          if (estimatedHours != null) 'estimatedHours': estimatedHours,
          if (acceptanceCriteria.isNotEmpty) 'acceptanceCriteria': acceptanceCriteria,
        },
      },
    ))
        .data);
    if (body['success'] == false) {
      throw AssistantException(body['error']?.toString() ?? 'create_failed');
    }
    return body['id']?.toString();
  }

  /// タスクへの問い合わせに答える（件数はデータベースが数えたもの）。
  Future<AskAnswer> ask(String text) async {
    final response = await _client.post('/assistant/ask', data: {'text': text});
    return AskAnswer.fromJson(_body(response.data));
  }

  /// 見守り：手当てが要るタスクの棚卸し。
  Future<SupervisionSurvey> getSupervision() async {
    final response = await _client.get('/assistant/supervision');
    return SupervisionSurvey.fromJson(_body(response.data));
  }

  /// 会話。[history] は直前までのやりとり（role は user / assistant）。
  /// 今回の [message] はサーバー側で末尾に足されるので history に含めない。
  Future<CopilotReply> chat(
    String message, {
    List<Map<String, String>> history = const [],
  }) async {
    final body = _body((await _client.post(
      '/copilot/chat',
      data: {
        'message': message,
        'taskId': null,
        'conversationHistory': history,
      },
    ))
        .data);
    if (body['success'] != true) {
      throw AssistantException(body['error']?.toString() ?? 'chat_failed');
    }
    return CopilotReply.fromJson(body);
  }
}

class AssistantException implements Exception {
  final String code;

  const AssistantException(this.code);

  @override
  String toString() => 'AssistantException($code)';
}
