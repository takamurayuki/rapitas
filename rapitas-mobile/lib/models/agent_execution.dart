class AgentExecution {
  final String id;
  final String? sessionId;
  final String? agentConfigId;
  final String? command;
  final String
      status; // pending, running, completed, failed, cancelled, interrupted
  final String? output;
  final Map<String, dynamic>? artifacts;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final int? tokensUsed;
  final int? executionTimeMs;
  final String? errorMessage;
  final String? question;
  final String? questionType;
  final Map<String, dynamic>? questionDetails;
  final String? claudeSessionId;
  final String? taskId;
  final AgentExecutionTask? task;
  final DateTime createdAt;

  AgentExecution({
    required this.id,
    this.sessionId,
    this.agentConfigId,
    this.command,
    this.status = 'pending',
    this.output,
    this.artifacts,
    this.startedAt,
    this.completedAt,
    this.tokensUsed,
    this.executionTimeMs,
    this.errorMessage,
    this.question,
    this.questionType,
    this.questionDetails,
    this.claudeSessionId,
    this.taskId,
    this.task,
    required this.createdAt,
  });

  factory AgentExecution.fromJson(Map<String, dynamic> json) {
    return AgentExecution(
      id: json['id'] as String,
      sessionId: json['sessionId'] as String?,
      agentConfigId: json['agentConfigId'] as String?,
      command: json['command'] as String?,
      status: json['status'] as String? ?? 'pending',
      output: json['output'] as String?,
      artifacts: json['artifacts'] != null
          ? Map<String, dynamic>.from(json['artifacts'] as Map)
          : null,
      startedAt: json['startedAt'] != null
          ? DateTime.parse(json['startedAt'] as String)
          : null,
      completedAt: json['completedAt'] != null
          ? DateTime.parse(json['completedAt'] as String)
          : null,
      tokensUsed: (json['tokensUsed'] as num?)?.toInt(),
      executionTimeMs: (json['executionTimeMs'] as num?)?.toInt(),
      errorMessage: json['errorMessage'] as String?,
      question: json['question'] as String?,
      questionType: json['questionType'] as String?,
      questionDetails: json['questionDetails'] != null
          ? Map<String, dynamic>.from(json['questionDetails'] as Map)
          : null,
      claudeSessionId: json['claudeSessionId'] as String?,
      taskId: json['taskId'] as String?,
      task: json['task'] != null
          ? AgentExecutionTask.fromJson(json['task'] as Map<String, dynamic>)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sessionId': sessionId,
      'agentConfigId': agentConfigId,
      'command': command,
      'status': status,
      'output': output,
      'artifacts': artifacts,
      'startedAt': startedAt?.toIso8601String(),
      'completedAt': completedAt?.toIso8601String(),
      'tokensUsed': tokensUsed,
      'executionTimeMs': executionTimeMs,
      'errorMessage': errorMessage,
      'question': question,
      'questionType': questionType,
      'questionDetails': questionDetails,
      'claudeSessionId': claudeSessionId,
      'taskId': taskId,
      'task': task?.toJson(),
      'createdAt': createdAt.toIso8601String(),
    };
  }

  bool get isRunning => status == 'running';
  bool get isCompleted => status == 'completed';
  bool get isFailed => status == 'failed';
  bool get hasQuestion => question != null && question!.isNotEmpty;

  String get durationText {
    if (executionTimeMs == null) return '-';
    final seconds = executionTimeMs! ~/ 1000;
    if (seconds < 60) return '$seconds秒';
    final minutes = seconds ~/ 60;
    final remainingSeconds = seconds % 60;
    return '$minutes分$remainingSeconds秒';
  }
}

class AgentExecutionTask {
  final String id;
  final String title;

  AgentExecutionTask({required this.id, required this.title});

  factory AgentExecutionTask.fromJson(Map<String, dynamic> json) {
    return AgentExecutionTask(
      id: json['id'] as String,
      title: json['title'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
    };
  }
}
