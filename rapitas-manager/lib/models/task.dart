class Task {
  final String id;
  final String title;
  final String? description;
  final String status; // todo, in-progress, done
  final String priority; // low, medium, high, urgent
  final List<dynamic>? labels;
  final double? estimatedHours;
  final double? actualHours;
  final DateTime? dueDate;
  final String? subject;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? parentId;
  final String? themeId;
  final String? projectId;
  final String? milestoneId;
  final String? examGoalId;
  final bool isDeveloperMode;
  final bool isAiTaskAnalysis;
  final bool agentGenerated;
  final bool agentExecutable;
  final bool autoExecutable;
  final String requireApproval; // always, major_only, never
  final String? executionInstructions;
  final String? githubIssueId;
  final String? githubPrId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<Task>? subtasks;
  final TaskTheme? theme;

  Task({
    required this.id,
    required this.title,
    this.description,
    this.status = 'todo',
    this.priority = 'medium',
    this.labels,
    this.estimatedHours,
    this.actualHours,
    this.dueDate,
    this.subject,
    this.startedAt,
    this.completedAt,
    this.parentId,
    this.themeId,
    this.projectId,
    this.milestoneId,
    this.examGoalId,
    this.isDeveloperMode = false,
    this.isAiTaskAnalysis = false,
    this.agentGenerated = false,
    this.agentExecutable = false,
    this.autoExecutable = false,
    this.requireApproval = 'never',
    this.executionInstructions,
    this.githubIssueId,
    this.githubPrId,
    required this.createdAt,
    required this.updatedAt,
    this.subtasks,
    this.theme,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'] as String,
      title: json['title'] as String,
      description: json['description'] as String?,
      status: json['status'] as String? ?? 'todo',
      priority: json['priority'] as String? ?? 'medium',
      labels: json['labels'] as List<dynamic>?,
      estimatedHours: (json['estimatedHours'] as num?)?.toDouble(),
      actualHours: (json['actualHours'] as num?)?.toDouble(),
      dueDate: json['dueDate'] != null
          ? DateTime.parse(json['dueDate'] as String)
          : null,
      subject: json['subject'] as String?,
      startedAt: json['startedAt'] != null
          ? DateTime.parse(json['startedAt'] as String)
          : null,
      completedAt: json['completedAt'] != null
          ? DateTime.parse(json['completedAt'] as String)
          : null,
      parentId: json['parentId'] as String?,
      themeId: json['themeId'] as String?,
      projectId: json['projectId'] as String?,
      milestoneId: json['milestoneId'] as String?,
      examGoalId: json['examGoalId'] as String?,
      isDeveloperMode: json['isDeveloperMode'] as bool? ?? false,
      isAiTaskAnalysis: json['isAiTaskAnalysis'] as bool? ?? false,
      agentGenerated: json['agentGenerated'] as bool? ?? false,
      agentExecutable: json['agentExecutable'] as bool? ?? false,
      autoExecutable: json['autoExecutable'] as bool? ?? false,
      requireApproval: json['requireApproval'] as String? ?? 'never',
      executionInstructions: json['executionInstructions'] as String?,
      githubIssueId: json['githubIssueId'] as String?,
      githubPrId: json['githubPrId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      subtasks: json['subtasks'] != null
          ? (json['subtasks'] as List<dynamic>)
              .map((e) => Task.fromJson(e as Map<String, dynamic>))
              .toList()
          : null,
      theme: json['theme'] != null
          ? TaskTheme.fromJson(json['theme'] as Map<String, dynamic>)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'status': status,
      'priority': priority,
      'labels': labels,
      'estimatedHours': estimatedHours,
      'actualHours': actualHours,
      'dueDate': dueDate?.toIso8601String(),
      'subject': subject,
      'startedAt': startedAt?.toIso8601String(),
      'completedAt': completedAt?.toIso8601String(),
      'parentId': parentId,
      'themeId': themeId,
      'projectId': projectId,
      'milestoneId': milestoneId,
      'examGoalId': examGoalId,
      'isDeveloperMode': isDeveloperMode,
      'isAiTaskAnalysis': isAiTaskAnalysis,
      'agentGenerated': agentGenerated,
      'agentExecutable': agentExecutable,
      'autoExecutable': autoExecutable,
      'requireApproval': requireApproval,
      'executionInstructions': executionInstructions,
      'githubIssueId': githubIssueId,
      'githubPrId': githubPrId,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'subtasks': subtasks?.map((e) => e.toJson()).toList(),
      'theme': theme?.toJson(),
    };
  }

  Task copyWith({
    String? id,
    String? title,
    String? description,
    String? status,
    String? priority,
    List<dynamic>? labels,
    double? estimatedHours,
    double? actualHours,
    DateTime? dueDate,
    String? subject,
    DateTime? startedAt,
    DateTime? completedAt,
    String? parentId,
    String? themeId,
    String? projectId,
    String? milestoneId,
    String? examGoalId,
    bool? isDeveloperMode,
    bool? isAiTaskAnalysis,
    bool? agentGenerated,
    bool? agentExecutable,
    bool? autoExecutable,
    String? requireApproval,
    String? executionInstructions,
    String? githubIssueId,
    String? githubPrId,
    DateTime? createdAt,
    DateTime? updatedAt,
    List<Task>? subtasks,
    TaskTheme? theme,
  }) {
    return Task(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      status: status ?? this.status,
      priority: priority ?? this.priority,
      labels: labels ?? this.labels,
      estimatedHours: estimatedHours ?? this.estimatedHours,
      actualHours: actualHours ?? this.actualHours,
      dueDate: dueDate ?? this.dueDate,
      subject: subject ?? this.subject,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      parentId: parentId ?? this.parentId,
      themeId: themeId ?? this.themeId,
      projectId: projectId ?? this.projectId,
      milestoneId: milestoneId ?? this.milestoneId,
      examGoalId: examGoalId ?? this.examGoalId,
      isDeveloperMode: isDeveloperMode ?? this.isDeveloperMode,
      isAiTaskAnalysis: isAiTaskAnalysis ?? this.isAiTaskAnalysis,
      agentGenerated: agentGenerated ?? this.agentGenerated,
      agentExecutable: agentExecutable ?? this.agentExecutable,
      autoExecutable: autoExecutable ?? this.autoExecutable,
      requireApproval: requireApproval ?? this.requireApproval,
      executionInstructions: executionInstructions ?? this.executionInstructions,
      githubIssueId: githubIssueId ?? this.githubIssueId,
      githubPrId: githubPrId ?? this.githubPrId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      subtasks: subtasks ?? this.subtasks,
      theme: theme ?? this.theme,
    );
  }
}

class TaskTheme {
  final String id;
  final String name;
  final String? color;

  TaskTheme({required this.id, required this.name, this.color});

  factory TaskTheme.fromJson(Map<String, dynamic> json) {
    return TaskTheme(
      id: json['id'] as String,
      name: json['name'] as String,
      color: json['color'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'color': color,
    };
  }
}
