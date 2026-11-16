import 'dart:convert';

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

  /// 完了条件（Task.acceptanceCriteria。DB では JSON 文字列の配列）。陪審はこれで判定する
  final List<String> acceptanceCriteria;

  /// 本人が確かめる完了条件（Task.userAcceptanceChecks。設計 4.1 案1）。陪審は判定に使わない。
  /// 列ができる前のタスク・古いサーバーでは空
  final List<String> userAcceptanceChecks;

  /// ワークフローの段階（draft / research_done / … / completed）。ワークフローに乗っていなければ null
  final String? workflowStatus;

  /// 自動の上限などで止まったときの理由コード（止まっていなければ null）
  final String? haltReason;

  /// AIエージェントで実行できるか。
  ///
  /// デスクトップと同じく実行可否はテーマ側で決まる：テーマが開発指定
  /// （Theme.isDevelopment）で、作業フォルダ（Theme.workingDirectory）が
  /// 設定されている場合のみ true。タスク側の agentExecutable /
  /// isDeveloperMode は通常のデスクトップ利用では立たないので判定に使わない。
  bool get canExecuteWithAgent =>
      theme != null &&
      theme!.isDevelopment &&
      (theme!.workingDirectory?.isNotEmpty ?? false);

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
    this.acceptanceCriteria = const [],
    this.userAcceptanceChecks = const [],
    this.workflowStatus,
    this.haltReason,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'].toString(),
      title: json['title'] as String,
      description: json['description'] as String?,
      status: json['status'] as String? ?? 'todo',
      priority: json['priority'] as String? ?? 'medium',
      labels: _parseLabels(json['labels']),
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
      parentId: json['parentId']?.toString(),
      themeId: json['themeId']?.toString(),
      projectId: json['projectId']?.toString(),
      milestoneId: json['milestoneId']?.toString(),
      examGoalId: json['examGoalId']?.toString(),
      isDeveloperMode: json['isDeveloperMode'] as bool? ?? false,
      isAiTaskAnalysis: json['isAiTaskAnalysis'] as bool? ?? false,
      agentGenerated: json['agentGenerated'] as bool? ?? false,
      agentExecutable: json['agentExecutable'] as bool? ?? false,
      autoExecutable: json['autoExecutable'] as bool? ?? false,
      requireApproval: json['requireApproval'] as String? ?? 'never',
      executionInstructions: json['executionInstructions'] as String?,
      githubIssueId: json['githubIssueId']?.toString(),
      githubPrId: json['githubPrId']?.toString(),
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
      acceptanceCriteria: _parseStringList(json['acceptanceCriteria']),
      userAcceptanceChecks: _parseStringList(json['userAcceptanceChecks']),
      workflowStatus: _nonEmpty(json['workflowStatus']),
      haltReason: _nonEmpty(json['haltReason']),
    );
  }

  /// JSON 文字列の配列（DB の保存形）でも配列そのものでも受ける。読めなければ空
  static List<String> _parseStringList(dynamic raw) {
    dynamic value = raw;
    if (value is String) {
      if (value.trim().isEmpty) return const [];
      try {
        value = jsonDecode(value);
      } catch (_) {
        return const [];
      }
    }
    if (value is! List) return const [];
    return [
      for (final v in value)
        if (v is String && v.trim().isNotEmpty) v.trim(),
    ];
  }

  static String? _nonEmpty(dynamic raw) =>
      raw is String && raw.trim().isNotEmpty ? raw : null;

  Map<String, dynamic> toJson() {
    return {
      'id': _idToJson(id),
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
      if (parentId != null) 'parentId': _idToJson(parentId),
      if (themeId != null) 'themeId': _idToJson(themeId),
      if (projectId != null) 'projectId': _idToJson(projectId),
      if (milestoneId != null) 'milestoneId': _idToJson(milestoneId),
      if (examGoalId != null) 'examGoalId': _idToJson(examGoalId),
      'isDeveloperMode': isDeveloperMode,
      'isAiTaskAnalysis': isAiTaskAnalysis,
      'agentGenerated': agentGenerated,
      'agentExecutable': agentExecutable,
      'autoExecutable': autoExecutable,
      'requireApproval': requireApproval,
      'executionInstructions': executionInstructions,
      if (githubIssueId != null) 'githubIssueId': _idToJson(githubIssueId),
      if (githubPrId != null) 'githubPrId': _idToJson(githubPrId),
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'subtasks': subtasks?.map((e) => e.toJson()).toList(),
      'theme': theme?.toJson(),
      'acceptanceCriteria': acceptanceCriteria,
      if (userAcceptanceChecks.isNotEmpty) 'userAcceptanceChecks': userAcceptanceChecks,
      if (workflowStatus != null) 'workflowStatus': workflowStatus,
      if (haltReason != null) 'haltReason': haltReason,
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
      acceptanceCriteria: acceptanceCriteria,
      userAcceptanceChecks: userAcceptanceChecks,
      workflowStatus: workflowStatus,
      haltReason: haltReason,
    );
  }
}

class TaskCategory {
  final String id;
  final String name;
  final String? color;
  final String? icon;
  final int? sortOrder;

  /// カテゴリの説明（Category.description）
  final String? description;

  /// カテゴリのモード（development / learning / both）。未設定なら null
  final String? mode;

  /// カテゴリに属するテーマ数（GET /categories の `_count.themes`）。
  /// テーマに埋め込まれたカテゴリ（GET /themes の category）には無いので null
  final int? themeCount;

  /// Category.isDefault（JSON に無ければ false）。
  ///
  /// NOTE: これは「初期投入されたシステム既定カテゴリ」の印で、seed-defaults が既定カテゴリ全部に立てる。
  /// PC 版の ☆（既定カテゴリ）は UserSettings.defaultCategoryId（GET /categories/default-category）で、
  /// こちらとは別物。☆ の判定には使わないこと。
  final bool isDefault;

  TaskCategory({
    required this.id,
    required this.name,
    this.color,
    this.icon,
    this.sortOrder,
    this.description,
    this.mode,
    this.themeCount,
    this.isDefault = false,
  });

  factory TaskCategory.fromJson(Map<String, dynamic> json) {
    final color = json['color'];
    final icon = json['icon'];
    final sortOrder = json['sortOrder'];
    final description = json['description'];
    final mode = json['mode'];
    final count = json['_count'];
    final themes = count is Map ? count['themes'] : null;
    final isDefault = json['isDefault'];
    return TaskCategory(
      id: json['id'].toString(),
      name: json['name']?.toString() ?? '',
      color: color is String ? color : null,
      icon: icon is String ? icon : null,
      sortOrder: sortOrder is num ? sortOrder.toInt() : null,
      description: description is String ? description : null,
      mode: mode is String ? mode : null,
      themeCount: themes is num ? themes.toInt() : null,
      isDefault: isDefault is bool ? isDefault : false,
    );
  }
}

class TaskTheme {
  final String id;
  final String name;
  final String? color;

  /// 所属カテゴリのID。GET /tasks の theme にも含まれる
  final String? categoryId;

  /// 所属カテゴリ。GET /themes のときだけ含まれる
  final TaskCategory? category;

  /// テーマに属するタスク数（GET /themes の `_count.tasks`）
  final int? taskCount;

  /// 開発テーマか（Theme.isDevelopment）。欠落時は false
  final bool isDevelopment;

  /// テーマの作業フォルダ（Theme.workingDirectory）。未設定なら null
  final String? workingDirectory;

  /// テーマの説明（Theme.description）。未設定なら null
  final String? description;

  /// カテゴリ内の ☆（既定テーマ。Theme.isDefault）。欠落時は false。
  /// PATCH /themes/:id/set-default が同じカテゴリ内の他テーマの ☆ を外すので、カテゴリごとに最大1つ
  final bool isDefault;

  TaskTheme({
    required this.id,
    required this.name,
    this.color,
    this.categoryId,
    this.category,
    this.taskCount,
    this.isDevelopment = false,
    this.workingDirectory,
    this.description,
    this.isDefault = false,
  });

  factory TaskTheme.fromJson(Map<String, dynamic> json) {
    final category = json['category'];
    final count = json['_count'];
    final tasks = count is Map ? count['tasks'] : null;
    final isDevelopment = json['isDevelopment'];
    final workingDirectory = json['workingDirectory'];
    final description = json['description'];
    final isDefault = json['isDefault'];
    return TaskTheme(
      id: json['id'].toString(),
      name: json['name'] as String,
      color: json['color'] as String?,
      categoryId: json['categoryId']?.toString(),
      category: category is Map
          ? TaskCategory.fromJson(Map<String, dynamic>.from(category))
          : null,
      taskCount: tasks is num ? tasks.toInt() : null,
      isDevelopment: isDevelopment is bool ? isDevelopment : false,
      workingDirectory: workingDirectory is String ? workingDirectory : null,
      description: description is String ? description : null,
      isDefault: isDefault is bool ? isDefault : false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': _idToJson(id),
      'name': name,
      'color': color,
    };
  }
}

/// テーマ一覧をカテゴリ単位にまとめた1グループ
class ThemeCategoryGroup {
  /// グループのキー。null は「その他」（カテゴリ未所属）
  final String? categoryId;

  /// カテゴリ。categoryId はあるがカテゴリ情報が取れなかった場合は null
  final TaskCategory? category;

  final List<TaskTheme> themes;

  const ThemeCategoryGroup({
    required this.categoryId,
    required this.category,
    required this.themes,
  });

  /// 「その他」グループ（カテゴリ未所属のテーマ）か
  bool get isUncategorized => categoryId == null;
}

/// テーマ一覧をカテゴリでグループ化する。
///
/// - グループの並び：
///   1. カテゴリの sortOrder 昇順（sortOrder が取れているグループ同士。同値は最初に現れた順）
///   2. sortOrder が無いグループ（カテゴリ情報なし等）はその後ろに、最初に現れた順
///   3. 「その他」（categoryId = null）は常に最後
/// - グループ内のテーマ順は入力順を維持
/// - カテゴリに属さないテーマは最後の1グループ（categoryId = null、「その他」）
/// - categoryId はあるがカテゴリ情報が無いテーマは「その他」に混ぜず、
///   categoryId 単位で別グループにする（category は同じ categoryId の
///   他のテーマから取れればそれを使い、取れなければ null）
List<ThemeCategoryGroup> groupThemesByCategory(List<TaskTheme> themes) {
  final order = <String>[];
  final themesByKey = <String, List<TaskTheme>>{};
  final categoryByKey = <String, TaskCategory>{};
  final uncategorized = <TaskTheme>[];

  for (final theme in themes) {
    // キーは categoryId のみ。categoryId が null なら category オブジェクトが
    // あっても「その他」に入れる（仕様）
    final key = theme.categoryId;
    if (key == null) {
      uncategorized.add(theme);
      continue;
    }
    final list = themesByKey.putIfAbsent(key, () {
      order.add(key);
      return <TaskTheme>[];
    });
    list.add(theme);
    final category = theme.category;
    if (category != null) categoryByKey.putIfAbsent(key, () => category);
  }

  // List.sort は安定ではないので、出現順（order のインデックス）をタイブレーカーにする
  final indexed = [for (var i = 0; i < order.length; i++) (index: i, key: order[i])];
  indexed.sort((a, b) {
    final sa = categoryByKey[a.key]?.sortOrder;
    final sb = categoryByKey[b.key]?.sortOrder;
    if (sa != null && sb != null && sa != sb) return sa.compareTo(sb);
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    return a.index.compareTo(b.index);
  });

  return [
    for (final entry in indexed)
      ThemeCategoryGroup(
        categoryId: entry.key,
        category: categoryByKey[entry.key],
        themes: List.unmodifiable(themesByKey[entry.key]!),
      ),
    if (uncategorized.isNotEmpty)
      ThemeCategoryGroup(
        categoryId: null,
        category: null,
        themes: List.unmodifiable(uncategorized),
      ),
  ];
}

/// Backend (Prisma) stores `labels` as a JSON-array string (default "[]"),
/// while older payloads may already send a list. Accept both.
List<dynamic>? _parseLabels(dynamic value) {
  if (value == null) return null;
  if (value is List) return value;
  if (value is String) {
    if (value.trim().isEmpty) return [];
    try {
      final decoded = jsonDecode(value);
      return decoded is List ? decoded : [];
    } on FormatException {
      return [];
    }
  }
  return [];
}

/// Backend IDs are Int. Send numeric strings back as int; leave anything
/// else (non-numeric string) untouched.
Object? _idToJson(String? value) {
  if (value == null) return null;
  return int.tryParse(value) ?? value;
}
