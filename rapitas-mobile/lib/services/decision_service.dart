import 'package:dio/dio.dart';
import 'api_client.dart';
import 'human_decision_client.dart';

/// 判断に失敗したときの、画面に出せる理由
class DecisionFailure implements Exception {
  final String message;
  final int? statusCode;
  const DecisionFailure(this.message, {this.statusCode});

  @override
  String toString() => message;
}

/// レビュー保留の中身（GET /workflow/tasks/:id/review-hold）
class ReviewHoldInfo {
  final String reason;
  final String detail;

  /// 指摘の要約（重い順に届いたまま）
  final List<String> findings;

  const ReviewHoldInfo({required this.reason, this.detail = '', this.findings = const []});
}

/// 判断画面が使う API（ラピ伴走化 第2段階-4）。
///
/// 読むだけの呼び出し（計画・質問の本文、保留の中身）は普通の ApiClient で、判断そのもの
/// （5つの操作）は [HumanDecisionClient] で送る。判断はラピを通さず、画面からバックエンドへ直接届く。
class DecisionService {
  final ApiClient _reads;
  final HumanDecisionClient _decide;

  /// halt 解除で、次はうまくいく理由に求める最低の文字数（バックエンドの MIN_HYPOTHESIS_CHARS）
  static const minHypothesisChars = 10;

  DecisionService(this._reads, this._decide);

  /// workflow ファイル（plan / question）の本文。無ければ null
  Future<String?> readWorkflowFile(String taskId, String fileType) async {
    final response = await _reads.get('/workflow/tasks/$taskId/files/$fileType');
    final data = (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    if (data['exists'] != true) return null;
    final content = data['content'];
    return content is String && content.trim().isNotEmpty ? content : null;
  }

  /// いまのレビュー保留。保留でなければ null
  Future<ReviewHoldInfo?> readReviewHold(String taskId) async {
    final response = await _reads.get('/workflow/tasks/$taskId/review-hold');
    final data = (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    final hold = data['hold'];
    if (data['held'] != true || hold is! Map) return null;
    return ReviewHoldInfo(
      reason: hold['reason'] as String? ?? '',
      detail: hold['detail'] as String? ?? '',
      findings: [
        for (final f in (hold['findings'] as List? ?? const []))
          if (f is Map && f['summary'] is String) f['summary'] as String,
      ],
    );
  }

  /// 計画を承認する（POST /workflow/tasks/:id/approve-plan）
  Future<void> approvePlan(String taskId) =>
      _send('/workflow/tasks/$taskId/approve-plan', {'approved': true});

  /// 計画の直してほしい点を伝える（POST /workflow/tasks/:id/revise-plan。計画づくりに戻る）
  Future<void> revisePlan(String taskId, String instruction) =>
      _send('/workflow/tasks/$taskId/revise-plan', {'instruction': instruction.trim()});

  /// エージェントの質問に答える（POST /workflow/tasks/:id/answer-question）
  Future<void> answerQuestion(String taskId, String answer) =>
      _send('/workflow/tasks/$taskId/answer-question', {'answer': answer.trim()});

  /// レビュー保留を解く。[override] が false なら指摘を受け入れて修復へ、true なら上書きして先へ
  Future<void> resolveReviewHold(String taskId, {required bool override, String? note}) => _send(
        '/workflow/tasks/$taskId/review-hold/resolve',
        {
          'action': override ? 'override' : 'accept',
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        },
      );

  /// 止まったタスクを再開する（POST /workflow/tasks/:id/release-halt）
  Future<void> releaseHalt(String taskId, String hypothesis) =>
      _send('/workflow/tasks/$taskId/release-halt', {'hypothesis': hypothesis.trim()});

  Future<void> _send(String path, Map<String, Object?> body) async {
    try {
      await _decide.post(path, data: body);
    } on DioException catch (e) {
      throw DecisionFailure(_messageOf(e), statusCode: e.response?.statusCode);
    }
  }

  static String _messageOf(DioException e) {
    final data = e.response?.data;
    if (data is Map) {
      final error = data['error'] ?? data['message'];
      if (error is String && error.trim().isNotEmpty) return _plain(error);
    }
    if (e.response == null) return 'バックエンドに接続できませんでした。';
    return '送れませんでした（${e.response?.statusCode}）。';
  }

  /// バックエンドが理由コードだけを返す場合の言い換え（ほかの文はそのまま見せる）
  static String _plain(String error) => switch (error) {
        'review_hold' => 'レビュー保留は、保留の判断（受け入れ／上書き）で解いてください。',
        'not_halted' => 'このタスクはもう止まっていません。',
        'not_found' => 'タスクが見つかりませんでした。',
        _ => error,
      };
}
