/// タスク中心の実行API（/tasks/:id/execute など）で使う型。
///
/// バックエンドの ID は数値で来るので、既存モデルと同じく文字列にそろえる。

DateTime? _parseDate(dynamic value) =>
    value == null ? null : DateTime.tryParse(value.toString());

/// GET /tasks/executing の1行。実行中（running / waiting_for_input）の実行。
/// タスク名は含まれないので、表示側でタスク一覧から引く。
class ExecutingTask {
  final String executionId;
  final String sessionId;
  final String taskId;
  final String? parentId;
  final String executionStatus; // running | waiting_for_input
  final DateTime? startedAt;
  final DateTime? sessionStartedAt;
  final int activeTimeMs;

  const ExecutingTask({
    required this.executionId,
    required this.sessionId,
    required this.taskId,
    this.parentId,
    required this.executionStatus,
    this.startedAt,
    this.sessionStartedAt,
    this.activeTimeMs = 0,
  });

  factory ExecutingTask.fromJson(Map<String, dynamic> json) {
    return ExecutingTask(
      executionId: json['executionId'].toString(),
      sessionId: json['sessionId'].toString(),
      taskId: json['taskId'].toString(),
      parentId: json['parentId']?.toString(),
      executionStatus: json['executionStatus'] as String? ?? 'running',
      startedAt: _parseDate(json['startedAt']),
      sessionStartedAt: _parseDate(json['sessionStartedAt']),
      activeTimeMs: (json['activeTimeMs'] as num?)?.toInt() ?? 0,
    );
  }

  bool get isWaitingForInput => executionStatus == 'waiting_for_input';
}

/// GET /agents/resumable-executions の1行。
/// 中断（interrupted）に加えて、メモリ上で生きている running / waiting_for_input も
/// 混ざって返る。再開できるのは canResume が true（= interrupted）のものだけ。
class ResumableExecution {
  final String id;
  // 契約上はタスクが外れた実行だと undefined になりうるので null 許容
  final String? taskId;
  final String? taskTitle;
  final String? sessionId;
  final String status;
  final String? claudeSessionId;
  final String? errorMessage;
  final String? output; // 出力の末尾500文字
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? createdAt;
  final String? workingDirectory;
  final String? workflowStatus;
  final String? workflowMode;
  final bool canResume;

  const ResumableExecution({
    required this.id,
    this.taskId,
    this.taskTitle,
    this.sessionId,
    required this.status,
    this.claudeSessionId,
    this.errorMessage,
    this.output,
    this.startedAt,
    this.completedAt,
    this.createdAt,
    this.workingDirectory,
    this.workflowStatus,
    this.workflowMode,
    this.canResume = false,
  });

  factory ResumableExecution.fromJson(Map<String, dynamic> json) {
    return ResumableExecution(
      id: json['id'].toString(),
      taskId: json['taskId']?.toString(),
      taskTitle: json['taskTitle'] as String?,
      sessionId: json['sessionId']?.toString(),
      status: json['status'] as String? ?? 'interrupted',
      claudeSessionId: json['claudeSessionId'] as String?,
      errorMessage: json['errorMessage'] as String?,
      output: json['output'] as String?,
      startedAt: _parseDate(json['startedAt']),
      completedAt: _parseDate(json['completedAt']),
      createdAt: _parseDate(json['createdAt']),
      workingDirectory: json['workingDirectory'] as String?,
      workflowStatus: json['workflowStatus'] as String?,
      workflowMode: json['workflowMode'] as String?,
      canResume: json['canResume'] == true,
    );
  }
}

/// POST /tasks/:id/execute の成功レスポンス。
/// 仕様確認の質問を作っただけで止まった場合（status: awaiting_question）は
/// sessionId が付かない。
class TaskExecutionStart {
  final String? sessionId;
  final String taskId;
  final String? message;
  final String? status;

  const TaskExecutionStart({
    this.sessionId,
    required this.taskId,
    this.message,
    this.status,
  });

  factory TaskExecutionStart.fromJson(
    Map<String, dynamic> json, {
    required String taskId,
  }) {
    return TaskExecutionStart(
      sessionId: json['sessionId']?.toString(),
      taskId: json['taskId']?.toString() ?? taskId,
      message: json['message'] as String?,
      status: json['status'] as String?,
    );
  }

  bool get isAwaitingQuestion => status == 'awaiting_question';
}
