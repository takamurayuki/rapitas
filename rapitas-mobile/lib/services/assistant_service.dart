import 'package:dio/dio.dart';
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

  /// assistant 系の受信タイムアウト。/assistant/ask などはデスクトップ側のローカル AI
  /// （Ollama）の生成を待つので、既定の 30 秒では足りないことがある。
  static const Duration receiveTimeout = Duration(seconds: 120);

  Future<Response<dynamic>> _post(String path, Object data) =>
      _guard(() => _client.post(path, data: data, receiveTimeout: receiveTimeout));

  Future<Response<dynamic>> _get(String path) =>
      _guard(() => _client.get(path, receiveTimeout: receiveTimeout));

  /// タイムアウト系の DioException を [AssistantTimeoutException] に包む
  /// （画面で一般の送信失敗と言い分けるため）。それ以外はそのまま投げる。
  static Future<Response<dynamic>> _guard(
      Future<Response<dynamic>> Function() request) async {
    try {
      return await request();
    } on DioException catch (e) {
      switch (e.type) {
        case DioExceptionType.receiveTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.connectionTimeout:
          throw AssistantTimeoutException(e.type);
        default:
          rethrow;
      }
    }
  }

  static Map<String, dynamic> _body(dynamic data) {
    if (data is Map) return Map<String, dynamic>.from(data);
    throw const AssistantException('unexpected_response');
  }

  /// 文の振り分け先を聞く。振り分けられなければ intent が null。
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    final response = await _post(
      '/assistant/route',
      {'text': text, 'hasOpenTask': hasOpenTask},
    );
    return RoutedIntent.fromJson(_body(response.data));
  }

  /// 文から下書きを作る（何も作成しない）。
  Future<TaskDraft> createDraft(String text) async {
    final body = _body((await _post(
      '/assistant/task-draft',
      {'text': text},
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
    final body = _body((await _post(
      '/assistant/task-create',
      {
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
    final response = await _post('/assistant/ask', {'text': text});
    return AskAnswer.fromJson(_body(response.data));
  }

  /// 見守り：手当てが要るタスクの棚卸し。
  Future<SupervisionSurvey> getSupervision() async {
    final response = await _get('/assistant/supervision');
    return SupervisionSurvey.fromJson(_body(response.data));
  }

  // ---- 変更（change）----
  // update-draft は読むだけ（提案カードを作る）。書き込みは task-update だけで、
  // ユーザーがカードで確認した変更を confirmed: true で送る。

  /// 文からどのタスクの何を変えるかの提案を受け取る（何も書き込まない）。
  Future<ChangeDraft> updateDraft(String text) async {
    final body = _body((await _post('/assistant/update-draft', {'text': text})).data);
    if (body['success'] != true || body['proposal'] is! Map) {
      throw AssistantException(body['error']?.toString() ?? 'no_proposal');
    }
    return ChangeDraft.fromJson(body);
  }

  /// ユーザーが確認した変更を適用する。
  ///
  /// 失敗は [AssistantException] で、code はサーバーの error（not_found / theme_not_found /
  /// no_change / 検証エラー文）、statusCode に HTTP の状態（400/404/409）が入る。
  /// 2xx で明示的に success:false が返ったときも statusCode にその状態（200 など）を入れる
  /// （サーバーが断ったと分かる失敗）。応答の形が読めないときは statusCode なしの
  /// unexpected_response（適用されたか分からない失敗）。
  Future<TaskUpdateResult> taskUpdate(String taskId, TaskChanges changes) async {
    final id = int.tryParse(taskId);
    if (id == null) throw const AssistantException('invalid_task');
    final response = await _postOrError('/assistant/task-update', {
      'taskId': id,
      'changes': changes.toJson(),
      'confirmed': true,
    });
    final body = _body(response.data);
    final success = body['success'];
    if (success == false) {
      throw AssistantException(body['error']?.toString() ?? 'update_failed',
          statusCode: response.statusCode);
    }
    if (success != true) throw const AssistantException('unexpected_response');
    return TaskUpdateResult.fromJson(body);
  }

  /// 適用した変更を取り消す。その後に別の編集が入った項目があれば（409）取り消さず、
  /// その項目名（status / priority / themeId / dueDate）を conflicts で返す。
  Future<TaskUpdateRevert> revertTaskUpdate(int actionId) async {
    try {
      final body =
          _body((await _postOrError('/assistant/task-update/revert', {'actionId': actionId})).data);
      if (body['success'] != true) {
        throw AssistantException(body['error']?.toString() ?? 'revert_failed');
      }
      return const TaskUpdateRevert();
    } on AssistantException catch (e) {
      final conflicts = e.conflicts;
      if (e.statusCode == 409 && conflicts.isNotEmpty) {
        return TaskUpdateRevert(conflicts: conflicts);
      }
      rethrow;
    }
  }

  // ---- 伴走（companion）----
  // 形はバックエンド routes/ai/assistant-companion.routes.ts が正：
  //   POST /assistant/companion/draft {text, taskId?}（何も書き込まない）
  //     → {matched:false} ／ {matched, action, needsTask:true} ／ {matched, action, unavailable?, proposal}
  //   POST /assistant/companion/start|stop {taskId, confirmed:true}（確認カードのボタンからだけ呼ぶ）

  /// 発言が「伴走して」「伴走をやめて」かを聞き、そうなら確認カードの材料を受け取る。
  /// 404（タスクが無い）は code: not_found の [AssistantException]。
  Future<RapiCompanionDraft> companionDraft(String text, {String? taskId}) async {
    final id = taskId == null ? null : int.tryParse(taskId);
    if (taskId != null && id == null) throw const AssistantException('invalid_task');
    final body = _body((await _postOrError('/assistant/companion/draft', {
      'text': text,
      if (id != null) 'taskId': id,
    }))
        .data);
    if (body['success'] == false) {
      throw AssistantException(body['error']?.toString() ?? 'draft_failed');
    }
    return RapiCompanionDraft.fromJson(body);
  }

  /// 確認カードで押された伴走の開始・終了を、confirmed: true で送る。
  /// 断られたら（409 already_active / not_active / task_done、404 など）その code の
  /// [AssistantException]（statusCode 付き）。
  Future<void> companionApply(RapiCompanionAction action, String taskId) async {
    final id = int.tryParse(taskId);
    if (id == null) throw const AssistantException('invalid_task');
    final path = action == RapiCompanionAction.start ? 'start' : 'stop';
    final response =
        await _postOrError('/assistant/companion/$path', {'taskId': id, 'confirmed': true});
    final body = _body(response.data);
    if (body['success'] == false) {
      throw AssistantException(body['error']?.toString() ?? 'companion_failed',
          statusCode: response.statusCode);
    }
    if (body['success'] != true) throw const AssistantException('unexpected_response');
  }

  // ---- 計画（roadmap）----
  // 形はバックエンド routes/ai/assistant-roadmap.routes.ts が正：
  //   POST /assistant/roadmap/draft {text, answers?: [{question, answer}]（各200字・最大6件）}
  //     → {success: true, available: false} ／ {success: true, available: true, draft}
  //     （何も書き込まない。answers 付きの2回目は質問を返さない最終形）
  //   POST /assistant/roadmap/commit {confirmed: true, goal, themeChoice, projectChoice, steps}
  //     → {success: true, themeId, projectId, taskIds, failedAfter}
  //     （AI を通さず、送った計画をそのまま作る。confirmed が無いと 400 confirmation_required）
  // NOTE: POST /assistant/research（候補の調査）は使わない。結果はデスクトップのノートにしか
  // 入らず、サーバー側の上限（300秒）がこの受信タイムアウト（120秒）より長いため。

  /// 目標の文から計画の下書きを作る（何も作成しない）。作れなかったら null（available: false）。
  /// [answers] は1回目の質問への回答（付けると最終形の下書きになる）
  Future<RoadmapDraft?> roadmapDraft(String text, {List<RoadmapAnswer> answers = const []}) async {
    final body = _body((await _postOrError('/assistant/roadmap/draft', {
      'text': text,
      if (answers.isNotEmpty)
        'answers': [for (final a in answers.take(rapiRoadmapMaxAnswers)) a.toJson()],
    }))
        .data);
    if (body['success'] == false) {
      throw AssistantException(body['error']?.toString() ?? 'draft_failed');
    }
    if (body['available'] != true) return null;
    final draft = body['draft'];
    if (draft is! Map) throw const AssistantException('unexpected_response');
    return RoadmapDraft.fromJson(Map<String, dynamic>.from(draft));
  }

  /// ユーザーが確認した計画 [draft] を、そのまま confirmed: true で作る。
  ///
  /// 失敗の分け方：サーバーが断った（4xx・2xx の success:false）なら statusCode 付きの
  /// [AssistantException]。形が読めない・作成結果として辻褄が合わない応答は statusCode なしの
  /// unexpected_response（作成済みかもしれないので、呼び出し側は結果不明として扱う）。
  Future<RoadmapCommitResult> roadmapCommit(RoadmapDraft draft) async {
    final steps = [for (final s in draft.steps.take(rapiRoadmapMaxSteps)) s.toJson()];
    final response = await _postOrError('/assistant/roadmap/commit', {
      'confirmed': true,
      'goal': draft.goal,
      'themeChoice': draft.themeChoice.toJson(),
      'projectChoice': draft.projectChoice.toJson(),
      'steps': steps,
    });
    final body = _body(response.data);
    final success = body['success'];
    if (success == false) {
      throw AssistantException(body['error']?.toString() ?? 'commit_failed',
          statusCode: response.statusCode);
    }
    if (success != true || !_isValidCommitResult(body, steps.length)) {
      throw const AssistantException('unexpected_response');
    }
    return RoadmapCommitResult.fromJson(body);
  }

  /// 作成結果の形と辻褄を確かめる（バックエンド services/assistant/roadmap-commit.ts の RoadmapResult）。
  /// - taskIds：要素はすべて整数で、送った手順数 [stepCount] を超えない
  /// - themeId / projectId：整数か null（キーが無いのも null とみなす）
  /// - failedAfter：null か整数。整数なら 0 以上・[stepCount] 未満（どれかの手順で止まった）で、
  ///   作れた件数 taskIds.length と一致する（サーバーは failedAfter = taskIds.length を入れる）
  static bool _isValidCommitResult(Map<String, dynamic> body, int stepCount) {
    bool intOrNull(dynamic v) => v == null || v is int;
    final ids = body['taskIds'];
    if (ids is! List || ids.any((id) => id is! int) || ids.length > stepCount) return false;
    if (!intOrNull(body['themeId']) || !intOrNull(body['projectId'])) return false;
    final failedAfter = body['failedAfter'];
    if (failedAfter == null) return true;
    return failedAfter is int &&
        failedAfter >= 0 &&
        failedAfter < stepCount &&
        failedAfter == ids.length;
  }

  // ---- 片付け（tidy）----
  // 形はバックエンド routes/ai/assistant-cleanup.routes.ts / routes/tasks/task-trash.routes.ts が正：
  //   POST /assistant/delete-filter {themeId?, statuses?: string[]（最大10）, updatedBeforeDays?}
  //     → {success: true, matches: [{id, title, status, updatedAt}], total, truncated, excludedProtected}
  //     （AI を使わずデータベースで絞る。保護されたタスクは外す。一覧は更新の古い順に最大500件）
  //   POST /assistant/delete-draft {text}（1〜2000字）
  //     → {success: true, available: true, candidates: [{id, title, status, themeId, reason}],
  //        considered, unclear} ／ AI 不達は {success: true, available: false, candidates: [], considered}
  //   POST /assistant/task-delete {confirmed: true, taskIds: number[]（1〜50件）}
  //     → {success: true, results: [{taskId, outcome: deleted/protected/not_found/failed, trashId?}]}
  //     （未確認は 400 confirmation_required。1件ずつ削除し、1件の失敗で残りを止めない）
  //   POST /task-trash/:id/restore（ボディなし）→ {success: true, task} ／
  //     戻せるものが無い（無い・復元済み・控えが読めない）は 409 {success: false, error: not_restorable}
  // delete-filter と delete-draft は一覧を作るだけで、何も削除しない。

  /// 条件 [filter] に当たるタスクの一覧（何も削除しない）
  Future<DeleteFilterResult> deleteFilter(TidyFilter filter) async {
    final body = _body((await _postOrError('/assistant/delete-filter', filter.toJson())).data);
    if (body['success'] != true) {
      throw AssistantException(body['error']?.toString() ?? 'filter_failed');
    }
    return DeleteFilterResult.fromJson(body);
  }

  /// 文 [text] から消してよさそうなタスクを挙げてもらう（何も削除しない）
  Future<DeleteDraftResult> deleteDraft(String text) async {
    final body = _body((await _postOrError('/assistant/delete-draft', {'text': text})).data);
    if (body['success'] != true) {
      throw AssistantException(body['error']?.toString() ?? 'draft_failed');
    }
    return DeleteDraftResult.fromJson(body);
  }

  /// 1回分（[rapiTidyBatchSize] 件まで）の削除を confirmed: true で送る。
  ///
  /// 失敗の分け方は roadmapCommit と同じ：サーバーが断った（4xx・2xx の success:false）なら
  /// statusCode 付きの [AssistantException]。形が読めない応答は statusCode なしの
  /// unexpected_response（削除済みかもしれない）。結果に載らなかった id は呼び出し側で不明扱いにする。
  Future<List<TaskDeletion>> taskDelete(List<String> taskIds) async {
    final ids = [for (final id in taskIds) int.tryParse(id)];
    if (ids.isEmpty || ids.length > rapiTidyBatchSize || ids.contains(null)) {
      throw const AssistantException('invalid_task');
    }
    final response =
        await _postOrError('/assistant/task-delete', {'confirmed': true, 'taskIds': ids});
    final body = _body(response.data);
    final success = body['success'];
    if (success == false) {
      throw AssistantException(body['error']?.toString() ?? 'delete_failed',
          statusCode: response.statusCode);
    }
    final results = body['results'];
    if (success != true || results is! List) throw const AssistantException('unexpected_response');
    const outcomes = {'deleted', 'protected', 'not_found', 'failed'};
    final sent = ids.toSet();
    return [
      for (final r in results)
        if (r is Map &&
            r['taskId'] is int &&
            sent.contains(r['taskId']) &&
            outcomes.contains(r['outcome']))
          TaskDeletion(
            taskId: '${r['taskId']}',
            outcome: r['outcome'] as String,
            trashId: r['outcome'] == 'deleted' && r['trashId'] is int ? r['trashId'] as int : null,
          ),
    ];
  }

  /// [taskIds] を [rapiTidyBatchSize] 件ずつ順に削除する（デスクトップ use-delete-filter.ts と同じ）。
  /// どこかの回が失敗したら、その回は結果不明（断られたなら rejected）にし、残りは送らずに止める。
  /// success:true でも結果が欠けた（送った id の結果が無い・outcome が未知）回は、欠けた分を
  /// 結果不明にしてそこで止め、残りは送らない。
  /// [onProgress] は回が終わるたびに（終えた回数, 全回数）で呼ぶ。
  Future<TaskDeleteRun> deleteTasks(
    List<String> taskIds, {
    void Function(int done, int of)? onProgress,
  }) async {
    final ids = taskIds.toSet().toList();
    final batches = <List<String>>[
      for (var i = 0; i < ids.length; i += rapiTidyBatchSize)
        ids.sublist(i, i + rapiTidyBatchSize > ids.length ? ids.length : i + rapiTidyBatchSize),
    ];
    final results = <TaskDeletion>[];
    final unknown = <String>[];
    final rejected = <String>[];
    for (var b = 0; b < batches.length; b++) {
      final batch = batches[b];
      try {
        final got = await taskDelete(batch);
        results.addAll(got);
        // 結果に載らなかった id（taskDelete が未知の outcome を捨てた分も含む）は、
        // 削除されたか分からない。結果が欠けた回は失敗した回と同じくそこで止め、残りは送らない。
        final answered = {for (final r in got) r.taskId};
        final missing = [for (final id in batch) if (!answered.contains(id)) id];
        if (missing.isNotEmpty) {
          unknown.addAll(missing);
          return TaskDeleteRun(
            results: results,
            unknown: unknown,
            unsent: [for (final later in batches.skip(b + 1)) ...later],
          );
        }
      } catch (e) {
        if (_rejected(e)) {
          rejected.addAll(batch);
        } else {
          unknown.addAll(batch);
        }
        return TaskDeleteRun(
          results: results,
          unknown: unknown,
          rejected: rejected,
          unsent: [for (final later in batches.skip(b + 1)) ...later],
        );
      }
      onProgress?.call(b + 1, batches.length);
    }
    return TaskDeleteRun(results: results, unknown: unknown);
  }

  /// サーバーが回ごと断った（＝その回は1件も削除していない）と言い切れる失敗か
  static bool _rejected(Object e) {
    if (e is! AssistantException) return false;
    if (e.code == 'invalid_task') return true;
    final status = e.statusCode;
    if (status == null) return false;
    return (status >= 400 && status < 500) || (status >= 200 && status < 300);
  }

  /// ゴミ箱の [trashId] からタスクを戻す。戻せるものが無ければ 409 の not_restorable。
  /// 同じ trashId を2回戻しても2回目は not_restorable になるだけなので、押し直してよい
  Future<void> restoreFromTrash(int trashId) async {
    final body = _body((await _postOrError('/task-trash/$trashId/restore', const {})).data);
    if (body['success'] != true) {
      throw AssistantException(body['error']?.toString() ?? 'restore_failed');
    }
  }

  /// 4xx/5xx を本文の error 付きの [AssistantException] にして投げる（タイムアウトは従来どおり）
  Future<Response<dynamic>> _postOrError(String path, Object data) async {
    try {
      return await _post(path, data);
    } on DioException catch (e) {
      final response = e.response;
      if (e.type != DioExceptionType.badResponse || response == null) rethrow;
      final body = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      throw AssistantException(
        body['error']?.toString() ?? 'http_${response.statusCode}',
        statusCode: response.statusCode,
        conflicts: body['conflicts'] is List
            ? (body['conflicts'] as List).whereType<String>().toList()
            : const [],
      );
    }
  }

  /// 会話。[history] は直前までのやりとり（role は user / assistant）。
  /// 今回の [message] はサーバー側で末尾に足されるので history に含めない。
  Future<CopilotReply> chat(
    String message, {
    List<Map<String, String>> history = const [],
  }) async {
    final body = _body((await _post(
      '/copilot/chat',
      {
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

  // ---- 相談（consult）----
  // タスク1件についての会話。形はバックエンド routes/ai/copilot-chat.ts が正：
  //   POST /copilot/chat {message, taskId: number, conversationHistory: [{role, content}]}
  //     → {success: true, content, model, tier, cached}（失敗は {error} だけで success なし）
  //   GET /copilot/chat/:taskId/history → {messages: [{id, taskId, role, content, createdAt}]}
  // サーバーは送った発言と返信をそのタスクの履歴として保存する（次に開いたときの history に出る）。

  /// タスク [taskId] についての相談を送る。[history] はそのタスクの相談スレッドの直近
  /// （role は user / assistant）。今回の [message] はサーバーが末尾に足すので含めない。
  Future<CopilotReply> copilotChat(
    String message, {
    required String taskId,
    List<Map<String, String>> history = const [],
  }) async {
    final id = int.tryParse(taskId);
    if (id == null) throw const AssistantException('invalid_task');
    final body = _body((await _postOrError(
      '/copilot/chat',
      {
        'message': message,
        'taskId': id,
        'conversationHistory': history,
      },
    ))
        .data);
    if (body['success'] != true) {
      throw AssistantException(body['error']?.toString() ?? 'chat_failed');
    }
    return CopilotReply.fromJson(body);
  }

  /// タスク [taskId] の過去の相談（古い順）。
  ///
  /// NOTE: サーバーは古い順に最大50件を返す（getCopilotHistory の take: 50）。
  /// 50件を超えるタスクでは新しい分が欠ける（デスクトップも同じ）。
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async {
    final id = int.tryParse(taskId);
    if (id == null) throw const AssistantException('invalid_task');
    final body = _body((await _get('/copilot/chat/$id/history')).data);
    final messages = body['messages'];
    if (messages is! List) return const [];
    return [
      for (final m in messages)
        if (m is Map) CopilotHistoryMessage.fromJson(Map<String, dynamic>.from(m)),
    ].where((m) => m.content.isNotEmpty).toList();
  }
}

class AssistantException implements Exception {
  final String code;

  /// HTTP の失敗応答だったときの状態コード（それ以外は null）
  final int? statusCode;

  /// task-update/revert の 409 で、その後に編集された項目
  final List<String> conflicts;

  const AssistantException(this.code, {this.statusCode, this.conflicts = const []});

  @override
  String toString() =>
      statusCode == null ? 'AssistantException($code)' : 'AssistantException($code, $statusCode)';
}

/// assistant 系の要求がタイムアウトした（デスクトップ側の生成が間に合わなかった等）
class AssistantTimeoutException implements Exception {
  final DioExceptionType type;

  const AssistantTimeoutException(this.type);

  @override
  String toString() => 'AssistantTimeoutException(${type.name})';
}
