// ラピ（デスクトップ rapitas の常駐エージェント）の API モデル。
// 契約はデスクトップ側：
//   rapitas-backend/routes/ai/assistant-intake.routes.ts（task-draft / task-create）
//   rapitas-backend/routes/ai/assistant-query.routes.ts（ask / supervision / route）
//   rapitas-backend/routes/ai/copilot-chat.ts（copilot/chat）
//   rapitas-backend/routes/ai/assistant-update.routes.ts（update-draft / task-update / revert）
// ID はバックエンドでは Int。アプリ内では Task と同じく文字列で持つ。

/// 優先度の表示ラベル（デスクトップ rapiAvatar.intake.priority と同じ表記）
const Map<String, String> rapiPriorityLabels = {
  'urgent': '緊急',
  'high': '高',
  'medium': '中',
  'low': '低',
};

/// 見守りの分類ラベル（デスクトップ rapiAvatar.watch.category と同じ表記）
const Map<String, String> supervisionCategoryLabels = {
  'held': '自動実行の対象外',
  'noTheme': 'テーマ未設定',
  'blocked': 'ブロック中',
  'stalled': '進行中のまま停滞',
  'overdue': '期限切れ',
};

/// 見守りの分類が「なぜ手当てが要るか」（デスクトップ rapiAvatar.watch.why と同じ表記）
const Map<String, String> supervisionCategoryReasons = {
  'held': '選定されないので、解除するまで動きません',
  'noTheme': '自動実行から見えないため、永久に選ばれません',
  'blocked': '設計上ブラインド再試行されず、手動の再試行が脱出口です',
  'stalled': '進行中ですが、しばらく何も動いていません',
  'overdue': '期限を過ぎていて、まだ終わっていません',
};

String? _string(dynamic value) => value is String ? value : null;

String? _id(dynamic value) => value?.toString();

List<String> _strings(dynamic value) =>
    value is List ? value.whereType<String>().toList() : const [];

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : const [];

/// テーマ候補（下書きの themeCandidates の要素）
class RapiThemeRef {
  final String id;
  final String name;

  const RapiThemeRef({required this.id, required this.name});

  factory RapiThemeRef.fromJson(Map<String, dynamic> json) => RapiThemeRef(
        id: json['id'].toString(),
        name: json['name']?.toString() ?? '',
      );
}

/// POST /assistant/task-draft の下書き。未作成なので ID を持たない。
class TaskDraft {
  final String title;
  final String? description;

  /// urgent / high / medium / low
  final String? priority;

  /// ISO 文字列（そのまま task-create に返す）
  final String? dueDate;
  final double? estimatedHours;

  /// テーマを1つに特定できたときだけ入る
  final String? themeId;

  /// 選ばせる候補。複数一致ならその一致分、一致なしなら全テーマ
  final List<RapiThemeRef> themeCandidates;

  /// まだユーザーが決める必要がある項目（title / theme / priority / dueDate / estimatedHours）
  final List<String> missing;

  /// テーマを選んだ理由（AI が読んだときだけ）
  final String? themeReason;

  /// 完了条件（AI が読んだときだけ。パターン推定では空）
  final List<String> acceptanceCriteria;

  /// ラピが判断できなかったこと
  final List<String> unclear;

  /// 'intent'（AI が読んだ）/ 'patterns'（書き方のパターンから推定）。レスポンス直下の source
  final String? source;

  const TaskDraft({
    required this.title,
    this.description,
    this.priority,
    this.dueDate,
    this.estimatedHours,
    this.themeId,
    this.themeCandidates = const [],
    this.missing = const [],
    this.themeReason,
    this.acceptanceCriteria = const [],
    this.unclear = const [],
    this.source,
  });

  /// [json] は draft オブジェクト。[source] はレスポンス直下の source。
  factory TaskDraft.fromJson(Map<String, dynamic> json, {String? source}) {
    final hours = json['estimatedHours'];
    return TaskDraft(
      title: json['title']?.toString() ?? '',
      description: _string(json['description']),
      priority: _string(json['priority']),
      dueDate: _string(json['dueDate']),
      estimatedHours: hours is num ? hours.toDouble() : null,
      themeId: _id(json['themeId']),
      themeCandidates: _maps(json['themeCandidates']).map(RapiThemeRef.fromJson).toList(),
      missing: _strings(json['missing']),
      themeReason: _string(json['themeReason']),
      acceptanceCriteria: _strings(json['acceptanceCriteria']),
      unclear: _strings(json['unclear']),
      source: source,
    );
  }

  /// パターン推定（AI が読めなかった）の下書きか
  bool get fellBackToPatterns => source == 'patterns';

  TaskDraft copyWith({String? title}) => TaskDraft(
        title: title ?? this.title,
        description: description,
        priority: priority,
        dueDate: dueDate,
        estimatedHours: estimatedHours,
        themeId: themeId,
        themeCandidates: themeCandidates,
        missing: missing,
        themeReason: themeReason,
        acceptanceCriteria: acceptanceCriteria,
        unclear: unclear,
        source: source,
      );
}

/// POST /assistant/ask の回答の1行（タスク）
class AskRow {
  final String id;
  final String title;
  final String status;
  final String priority;
  final DateTime? dueDate;

  const AskRow({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    this.dueDate,
  });

  factory AskRow.fromJson(Map<String, dynamic> json) {
    final due = json['dueDate'];
    return AskRow(
      id: json['id'].toString(),
      title: json['title']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      priority: json['priority']?.toString() ?? '',
      dueDate: due is String ? DateTime.tryParse(due) : null,
    );
  }
}

/// POST /assistant/ask の回答
class AskAnswer {
  /// false のときは質問を読み取れなかった（「0件」ではない）
  final bool available;
  final int total;
  final List<AskRow> rows;

  /// ラピが判断できなかったこと
  final List<String> unclear;

  const AskAnswer({
    required this.available,
    this.total = 0,
    this.rows = const [],
    this.unclear = const [],
  });

  factory AskAnswer.fromJson(Map<String, dynamic> json) {
    final total = json['total'];
    return AskAnswer(
      available: json['available'] == true,
      total: total is num ? total.toInt() : 0,
      rows: _maps(json['rows']).map(AskRow.fromJson).toList(),
      unclear: _strings(json['unclear']),
    );
  }
}

/// 見守りの1タスク（デスクトップ TaskWatch.tsx の WatchedTask）
class WatchedTask {
  final String id;
  final String title;
  final String status;
  final String? themeId;
  final DateTime? dueDate;
  final DateTime? updatedAt;

  const WatchedTask({
    required this.id,
    required this.title,
    required this.status,
    this.themeId,
    this.dueDate,
    this.updatedAt,
  });

  factory WatchedTask.fromJson(Map<String, dynamic> json) {
    final due = json['dueDate'];
    final updated = json['updatedAt'];
    return WatchedTask(
      id: json['id'].toString(),
      title: json['title']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      themeId: _id(json['themeId']),
      dueDate: due is String ? DateTime.tryParse(due) : null,
      updatedAt: updated is String ? DateTime.tryParse(updated) : null,
    );
  }

  /// 最終更新からの日数（デスクトップの「N日」表示と同じ計算）。不明なら null
  int? daysWaiting([DateTime? now]) {
    final updated = updatedAt;
    if (updated == null) return null;
    return (now ?? DateTime.now()).difference(updated).inDays;
  }
}

/// 見守りの1分類
class SupervisionFinding {
  /// held / noTheme / blocked / stalled / overdue
  final String category;

  /// 該当した総数（tasks は最大10件の抜粋）
  final int total;
  final List<WatchedTask> tasks;

  const SupervisionFinding({
    required this.category,
    required this.total,
    this.tasks = const [],
  });

  factory SupervisionFinding.fromJson(Map<String, dynamic> json) {
    final total = json['total'];
    return SupervisionFinding(
      category: json['category']?.toString() ?? '',
      total: total is num ? total.toInt() : 0,
      tasks: _maps(json['tasks']).map(WatchedTask.fromJson).toList(),
    );
  }

  String get label => supervisionCategoryLabels[category] ?? category;
  String? get reason => supervisionCategoryReasons[category];
}

/// GET /assistant/supervision の棚卸し
class SupervisionSurvey {
  final int total;
  final List<SupervisionFinding> categories;

  const SupervisionSurvey({required this.total, this.categories = const []});

  factory SupervisionSurvey.fromJson(Map<String, dynamic> json) {
    final total = json['total'];
    return SupervisionSurvey(
      total: total is num ? total.toInt() : 0,
      categories: _maps(json['categories']).map(SupervisionFinding.fromJson).toList(),
    );
  }

  /// 手当てが要る（1件以上ある）分類だけ
  List<SupervisionFinding> get needing =>
      categories.where((c) => c.total > 0).toList();
}

/// POST /assistant/route の振り分け結果
class RoutedIntent {
  /// 振り分け先。振り分けられなかったときは null
  final String? intent;
  final String? reason;

  const RoutedIntent({this.intent, this.reason});

  factory RoutedIntent.fromJson(Map<String, dynamic> json) {
    final isRouted = json['routed'] == true;
    return RoutedIntent(
      intent: isRouted ? _string(json['intent']) : null,
      reason: isRouted ? _string(json['reason']) : null,
    );
  }

  bool get routed => intent != null;
}

/// POST /copilot/chat の返答
class CopilotReply {
  final String content;
  final String? model;
  final String? tier;
  final bool cached;

  const CopilotReply({
    required this.content,
    this.model,
    this.tier,
    this.cached = false,
  });

  factory CopilotReply.fromJson(Map<String, dynamic> json) => CopilotReply(
        content: json['content']?.toString() ?? '',
        model: _string(json['model']),
        tier: _string(json['tier']),
        cached: json['cached'] == true,
      );
}

// ---- 変更（change）----
// 既存タスク1件の 状態／優先度／テーマ／期限 を文で変える。形はバックエンドが正：
//   services/assistant/task-update.ts（TaskChanges の検証・before/after）
//   services/assistant/update-proposal.ts（proposal / unclear）

/// ラピが変えられる項目（バックエンド task-update.ts の FIELDS と同じ順）
const List<String> rapiChangeFields = ['status', 'priority', 'themeId', 'dueDate'];

/// 変更項目の表示名（デスクトップ rapiAvatar.change.field と同じ表記）
const Map<String, String> rapiChangeFieldLabels = {
  'status': '状態',
  'priority': '優先度',
  'themeId': 'テーマ',
  'dueDate': '期限',
};

/// 変更で使う状態の表示名（デスクトップ rapiAvatar.change.value と同じ表記）
const Map<String, String> rapiChangeStatusLabels = {
  'todo': '未着手',
  'in-progress': '進行中',
  'done': '完了',
};

/// 変更する項目と新しい値。[values] にはキーがある項目だけが入る
/// （themeId / dueDate の null は「外す」で、キーが無い＝変えないとは別）。
/// themeId は数値、dueDate は `YYYY-MM-DD`（サーバーへはそのまま返す）。
class TaskChanges {
  final Map<String, Object?> values;

  const TaskChanges(this.values);

  factory TaskChanges.fromJson(Map<String, dynamic> json) => TaskChanges({
        for (final f in rapiChangeFields)
          if (json.containsKey(f)) f: json[f],
      });

  /// 変える項目（表示順）
  List<String> get fields => [for (final f in rapiChangeFields) if (values.containsKey(f)) f];

  bool get isEmpty => values.isEmpty;

  Map<String, Object?> toJson() => Map<String, Object?>.from(values);
}

/// POST /assistant/update-draft の提案（まだ何も書き込んでいない）
class ChangeProposal {
  final String taskId;
  final String title;
  final TaskChanges changes;

  /// なぜそう読んだか（空のこともある）
  final String reason;

  const ChangeProposal({
    required this.taskId,
    required this.title,
    required this.changes,
    this.reason = '',
  });

  factory ChangeProposal.fromJson(Map<String, dynamic> json) => ChangeProposal(
        taskId: json['taskId'].toString(),
        title: json['title']?.toString() ?? '',
        changes: TaskChanges.fromJson(
            json['changes'] is Map ? Map<String, dynamic>.from(json['changes'] as Map) : const {}),
        reason: _string(json['reason']) ?? '',
      );
}

/// POST /assistant/update-draft の結果。[proposal] か [unclear] のどちらか
class ChangeDraft {
  final ChangeProposal? proposal;

  /// 対象や内容を読み取れなかった理由（proposal が無いとき）
  final List<String> unclear;

  /// 検討したタスク数（最近更新されたものから最大60件。全件ではない）
  final int considered;

  const ChangeDraft({this.proposal, this.unclear = const [], this.considered = 0});

  factory ChangeDraft.fromJson(Map<String, dynamic> json) {
    final p = json['proposal'];
    final considered = json['considered'];
    final count = considered is num ? considered.toInt() : 0;
    if (p is Map && p['kind'] == 'proposal') {
      return ChangeDraft(
        proposal: ChangeProposal.fromJson(Map<String, dynamic>.from(p)),
        considered: count,
      );
    }
    final unclear = p is Map ? _strings(p['unclear']) : const <String>[];
    return ChangeDraft(
      unclear: unclear.isNotEmpty ? unclear : const ['発話から変更内容を読み取れませんでした。'],
      considered: count,
    );
  }
}

/// POST /assistant/task-update の適用結果。before / after は実際に変わった項目だけ
/// （提案と同じ値だった項目はサーバーが書かずに省く）
class TaskUpdateResult {
  /// 取り消し（revert）に使う監査の ID
  final int actionId;
  final Map<String, Object?> before;
  final Map<String, Object?> after;

  const TaskUpdateResult({
    required this.actionId,
    this.before = const {},
    this.after = const {},
  });

  factory TaskUpdateResult.fromJson(Map<String, dynamic> json) {
    Map<String, Object?> fields(dynamic v) =>
        v is Map ? Map<String, Object?>.from(v) : const <String, Object?>{};
    final id = json['actionId'];
    return TaskUpdateResult(
      actionId: id is num ? id.toInt() : int.tryParse('$id') ?? 0,
      before: fields(json['before']),
      after: fields(json['after']),
    );
  }
}

/// POST /assistant/task-update/revert の結果。[conflicts] が空でなければ取り消していない
/// （409：ラピの変更のあとに、その項目が別に編集された）
class TaskUpdateRevert {
  final List<String> conflicts;

  const TaskUpdateRevert({this.conflicts = const []});

  bool get reverted => conflicts.isEmpty;
}
