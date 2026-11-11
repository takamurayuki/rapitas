// ラピ（デスクトップ rapitas の常駐エージェント）の API モデル。
// 契約はデスクトップ側：
//   rapitas-backend/routes/ai/assistant-intake.routes.ts（task-draft / task-create）
//   rapitas-backend/routes/ai/assistant-query.routes.ts（ask / supervision / route）
//   rapitas-backend/routes/ai/copilot-chat.ts（copilot/chat）
//   rapitas-backend/routes/ai/assistant-update.routes.ts（update-draft / task-update / revert）
//   rapitas-backend/routes/ai/assistant-roadmap.routes.ts（roadmap/draft / roadmap/commit）
//   rapitas-backend/routes/ai/assistant-cleanup.routes.ts（delete-filter / delete-draft / task-delete）
//   rapitas-backend/routes/tasks/task-trash.routes.ts（task-trash/:id/restore）
// ID はバックエンドでは Int。アプリ内では Task と同じく文字列で持つ。

import 'rapi_companion.dart';
export 'rapi_companion.dart';
export 'rapi_criteria_edit.dart';

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

  /// 完了条件。サーバーは必ず1件以上付けて返す（AI が出さなかったときはタイトルから作った仮の案）
  final List<String> acceptanceCriteria;

  /// 完了条件がラピの仮の案（AI が出さなかったのでタイトルから作った）か
  final bool acceptanceCriteriaFallback;

  /// 完了条件1件ずつの見せ方（誰が確かめるか・確かめにくい言葉・ラピが補ったか）。
  /// [acceptanceCriteria] と同じ順。古いサーバーは返さないので空のことがある
  final List<RapiCriterionItem> criteriaItems;

  /// 完了条件の採点（spec-quality-checker）。古いサーバーは返さない
  final RapiCriteriaQuality? criteriaQuality;

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
    this.acceptanceCriteriaFallback = false,
    this.criteriaItems = const [],
    this.criteriaQuality,
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
      acceptanceCriteriaFallback: json['acceptanceCriteriaFallback'] == true,
      criteriaItems: rapiCriterionItems(json['acceptanceCriteriaItems']),
      criteriaQuality: RapiCriteriaQuality.fromJson(json['criteriaQuality']),
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
        acceptanceCriteriaFallback: acceptanceCriteriaFallback,
        criteriaItems: criteriaItems,
        criteriaQuality: criteriaQuality,
        unclear: unclear,
        source: source,
      );

  /// カードに並べる完了条件。項目の情報が無い（古いサーバー）ときは文だけで作る
  List<RapiCriterionItem> get criteriaRows =>
      criteriaItems.length == acceptanceCriteria.length && criteriaItems.isNotEmpty
          ? criteriaItems
          : [for (final c in acceptanceCriteria) RapiCriterionItem(text: c)];
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

/// 相談（consult）の過去のやりとり1件（GET /copilot/chat/:taskId/history の messages）。
/// 形はバックエンド services/ai/copilot-chat-service.ts getCopilotHistory（CopilotMessage 行）が正。
/// role はサーバーが user / assistant で保存する。それ以外が来たらデスクトップと同じく assistant とみなす。
class CopilotHistoryMessage {
  final String id;
  final bool fromUser;
  final String content;
  final DateTime? createdAt;

  const CopilotHistoryMessage({
    required this.id,
    required this.fromUser,
    required this.content,
    this.createdAt,
  });

  factory CopilotHistoryMessage.fromJson(Map<String, dynamic> json) => CopilotHistoryMessage(
        id: json['id']?.toString() ?? '',
        fromUser: json['role'] == 'user',
        content: json['content']?.toString() ?? '',
        createdAt: json['createdAt'] is String
            ? DateTime.tryParse(json['createdAt'] as String)
            : null,
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

// ---- 計画（roadmap）----
// 目標の文から計画（テーマ／プロジェクトの置き場所・確認の質問・手順）を作り、
// 確認後にテーマ／プロジェクト／タスクをまとめて作る。形はバックエンドが正：
//   routes/ai/assistant-roadmap.routes.ts（draft / commit の入力の検証）
//   services/assistant/roadmap-types.ts（RoadmapDraft）・roadmap-commit.ts（RoadmapResult）

/// 計画の手順の上限（commit の steps の maxItems）
const int rapiRoadmapMaxSteps = 20;

/// 再下書きに付ける回答の上限（MAX_ROADMAP_QUESTIONS）と、質問・回答それぞれの最大文字数
const int rapiRoadmapMaxAnswers = 6;
const int rapiRoadmapAnswerMaxLength = 200;

/// テーマ／プロジェクトの置き場所。kind は existing（既存の [id]）／new（[name] で新規作成）／
/// none（置かない）。commit にはサーバーが返した形をそのまま返す（画面で組み替えない）
class RoadmapPlacement {
  final String kind;
  final int? id;
  final String? name;
  final String? reason;

  const RoadmapPlacement({required this.kind, this.id, this.name, this.reason});

  factory RoadmapPlacement.fromJson(dynamic json) {
    if (json is! Map) return const RoadmapPlacement(kind: 'none');
    final kind = json['kind'];
    final id = json['id'];
    final parsedId = id is num ? id.toInt() : int.tryParse('$id');
    final name = _string(json['name']);
    final reason = _string(json['reason']);
    // 読めない形は「置かない」に倒す（存在しない id や空の名前で作らせない）
    if (kind == 'existing' && parsedId != null) {
      return RoadmapPlacement(kind: 'existing', id: parsedId, name: name);
    }
    if (kind == 'new' && name != null && name.trim().isNotEmpty) {
      return RoadmapPlacement(kind: 'new', name: name, reason: reason);
    }
    return RoadmapPlacement(kind: 'none', reason: reason);
  }

  bool get isNew => kind == 'new';
  bool get isExisting => kind == 'existing';
  bool get isNone => kind == 'none';

  /// commit の themeChoice / projectChoice（routes の placement の Union に合う鍵だけ）
  Map<String, dynamic> toJson() => switch (kind) {
        'existing' => {'kind': 'existing', 'id': id, if (name != null) 'name': name},
        'new' => {'kind': 'new', 'name': name, if (reason != null) 'reason': reason},
        _ => {'kind': 'none', if (reason != null) 'reason': reason},
      };
}

/// 確認の質問（選択式）。[recommended] はラピの推奨（選択肢の初期値にする）
class RoadmapQuestion {
  final String question;
  final List<String> options;
  final String? recommended;
  final String? recommendedReason;

  const RoadmapQuestion({
    required this.question,
    this.options = const [],
    this.recommended,
    this.recommendedReason,
  });

  factory RoadmapQuestion.fromJson(Map<String, dynamic> json) => RoadmapQuestion(
        question: json['question']?.toString() ?? '',
        options: _strings(json['options']),
        recommended: _string(json['recommended']),
        recommendedReason: _string(json['recommendedReason']),
      );

  /// 初期選択：推奨（選択肢にあれば）→ 先頭の選択肢 → なし
  String? get initialAnswer {
    final r = recommended;
    if (r != null && r.isNotEmpty && (options.isEmpty || options.contains(r))) return r;
    return options.isNotEmpty ? options.first : r;
  }
}

/// 計画の手順1つ（作成されるタスク1件）。[description] はそのままタスクの説明になる
class RoadmapStep {
  final String title;
  final String description;

  /// 期限（YYYY-MM-DD）。依頼に期限があったときだけ
  final String? dueDate;

  /// 完了条件（説明文の「## 完了条件」と同じもの）。commit でタスクの完了条件の列に入る
  final List<String> acceptanceCriteria;

  /// 完了条件1件ずつの見せ方（表示だけ。commit では送らない）
  final List<RapiCriterionItem> criteriaItems;

  /// 完了条件の採点（spec-quality-checker）。表示だけ。古いサーバーは返さない
  final RapiCriteriaQuality? criteriaQuality;

  /// 確定した「本人が確かめる」条件（commit で送る。サーバーが判定し直して userAcceptanceChecks へ）
  final List<String> userAcceptanceChecks;

  const RoadmapStep({
    required this.title,
    this.description = '',
    this.dueDate,
    this.acceptanceCriteria = const [],
    this.criteriaItems = const [],
    this.criteriaQuality,
    this.userAcceptanceChecks = const [],
  });

  /// カードに並べる完了条件。項目の情報が無い（古いサーバー）ときは文だけで作る
  List<RapiCriterionItem> get criteriaRows =>
      criteriaItems.length == acceptanceCriteria.length && criteriaItems.isNotEmpty
          ? criteriaItems
          : [for (final c in acceptanceCriteria) RapiCriterionItem(text: c)];

  /// 説明文から「## 完了条件」の節を除いたもの（条件はカードの一覧で別に出すので、二重に見せない）
  String get descriptionWithoutCriteria => description
      .replaceFirst(RegExp(r'^##\s*完了条件\s*$[\s\S]*?(?=^#{1,6}\s|(?![\s\S]))', multiLine: true), '')
      .trim();

  /// カードで確定した条件で送る形にした手順（陪審の条件 [jury] と本人の条件 [user]）。
  /// 説明文の「## 完了条件」は陪審の条件だけで作り直す。説明文は陪審にそのまま渡るので、
  /// 本人の条件は書かない（本人の条件は userAcceptanceChecks の列だけに入る。サーバーも同じ形で保存する）
  RoadmapStep withConfirmed({required List<String> jury, required List<String> user}) =>
      RoadmapStep(
        title: title,
        description: [
          if (descriptionWithoutCriteria.isNotEmpty) descriptionWithoutCriteria,
          if (jury.isNotEmpty) ['## 完了条件', for (final c in jury) '- [ ] $c'].join('\n'),
        ].join('\n\n'),
        dueDate: dueDate,
        acceptanceCriteria: jury,
        criteriaItems: criteriaItems,
        criteriaQuality: criteriaQuality,
        userAcceptanceChecks: user,
      );

  factory RoadmapStep.fromJson(Map<String, dynamic> json) {
    final due = _string(json['dueDate']);
    return RoadmapStep(
      title: json['title']?.toString() ?? '',
      description: _string(json['description']) ?? '',
      dueDate: due != null && RegExp(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$').hasMatch(due) ? due : null,
      acceptanceCriteria: _strings(json['acceptanceCriteria']),
      criteriaItems: rapiCriterionItems(json['criteriaItems']),
      criteriaQuality: RapiCriteriaQuality.fromJson(json['criteriaQuality']),
    );
  }

  Map<String, dynamic> toJson() => {
        'title': title,
        'description': description,
        if (dueDate != null) 'dueDate': dueDate,
        // カードで採った条件（外した条件は含めない）。説明文の「## 完了条件」と違えば、
        // サーバーが確定した条件で説明文を作り直す
        if (acceptanceCriteria.isNotEmpty) 'acceptanceCriteria': acceptanceCriteria,
        if (userAcceptanceChecks.isNotEmpty) 'userAcceptanceChecks': userAcceptanceChecks,
      };
}

/// POST /assistant/roadmap/draft の下書き（まだ何も作っていない）
class RoadmapDraft {
  /// ラピが読み取った目標（読み違いが作成前に分かるように出す）
  final String goal;
  final RoadmapPlacement themeChoice;
  final RoadmapPlacement projectChoice;

  /// 確認の質問。空なら最終形（回答を付けた2回目の下書きは質問を返さない）
  final List<RoadmapQuestion> questions;
  final List<RoadmapStep> steps;

  /// 依頼から読み取った期限（YYYY-MM-DD）
  final String? deadline;

  /// 計画の前提（デスクトップではノートに書く材料。モバイルでは表示だけ）
  final List<String> assumptions;

  /// 比較の観点（候補を比べる目標のとき）。デスクトップでは候補調査とノートの表に使う
  final List<String> comparisonAxes;

  const RoadmapDraft({
    required this.goal,
    required this.themeChoice,
    required this.projectChoice,
    this.questions = const [],
    this.steps = const [],
    this.deadline,
    this.assumptions = const [],
    this.comparisonAxes = const [],
  });

  factory RoadmapDraft.fromJson(Map<String, dynamic> json) => RoadmapDraft(
        goal: json['goal']?.toString() ?? '',
        themeChoice: RoadmapPlacement.fromJson(json['themeChoice']),
        projectChoice: RoadmapPlacement.fromJson(json['projectChoice']),
        questions: [
          for (final q in _maps(json['questions'])) RoadmapQuestion.fromJson(q),
        ].where((q) => q.question.isNotEmpty).toList(),
        steps: [
          for (final s in _maps(json['steps'])) RoadmapStep.fromJson(s),
        ].where((s) => s.title.isNotEmpty).take(rapiRoadmapMaxSteps).toList(),
        deadline: _string(json['deadline']),
        assumptions: _strings(json['assumptions']),
        comparisonAxes: _strings(json['comparisonAxes']),
      );

  /// 確認の質問が残っている（まだ下書きの段階で、作成はできない）
  bool get hasQuestions => questions.isNotEmpty;
}

/// 質問と選んだ答え（再下書きの answers の1件）
class RoadmapAnswer {
  final String question;
  final String answer;

  const RoadmapAnswer({required this.question, required this.answer});

  /// サーバーの上限（各200字）に合わせて切る。空の答えは「—」（デスクトップと同じ）
  Map<String, String> toJson() {
    String clip(String s) =>
        s.length > rapiRoadmapAnswerMaxLength ? s.substring(0, rapiRoadmapAnswerMaxLength) : s;
    final a = answer.trim().isEmpty ? '—' : answer;
    return {'question': clip(question), 'answer': clip(a)};
  }
}

/// POST /assistant/roadmap/commit の結果
class RoadmapCommitResult {
  /// タスクを入れたテーマ（なければ null）
  final int? themeId;

  /// タスクを紐づけたプロジェクト（なければ null）
  final int? projectId;

  /// 作られたタスク（計画の順）
  final List<String> taskIds;

  /// 途中で止まったときの、止まるまでに作れた件数（最後まで作れたら null。0 もありうる）
  final int? failedAfter;

  const RoadmapCommitResult({
    this.themeId,
    this.projectId,
    this.taskIds = const [],
    this.failedAfter,
  });

  factory RoadmapCommitResult.fromJson(Map<String, dynamic> json) {
    int? n(dynamic v) => v is num ? v.toInt() : null;
    final ids = json['taskIds'];
    return RoadmapCommitResult(
      themeId: n(json['themeId']),
      projectId: n(json['projectId']),
      taskIds: ids is List ? [for (final id in ids) if (id != null) id.toString()] : const [],
      failedAfter: n(json['failedAfter']),
    );
  }

  bool get stoppedPartway => failedAfter != null;
}

// ---- 片付け（tidy）----
// 不要なタスクを削除する。候補の出し方は2つ（条件／文章）で、どちらも一覧を作るだけ。
// 削除は「画面に出て、チェックが残った id」だけを task-delete（confirmed: true）へ送る。
// 削除はゴミ箱経由なので、trashId ごとに restore で取り消せる。形はバックエンドが正：
//   routes/ai/assistant-cleanup.routes.ts（delete-filter / delete-draft / task-delete の入力の検証）
//   services/assistant/delete-filter.ts（FilterMatch・DeleteFilterResult・FILTERABLE_STATUSES）
//   services/assistant/delete-proposal.ts（DeleteCandidate・DeleteProposal・CANDIDATE_WINDOW）
//   services/task/task-deletion.ts（DeletionResult）・routes/tasks/task-trash.routes.ts（restore）

/// task-delete の1回あたりの上限（taskIds の maxItems）
const int rapiTidyBatchSize = 50;

/// 条件で選べる状態（デスクトップ TaskBulkCleanup.tsx の STATUSES と同じ順）
const List<String> rapiTidyStatuses = ['cancelled', 'done', 'blocked', 'todo'];

/// ラピ経由で「完了」を書こうとしたときにサーバーが返す error（409）。
/// 完了の判定は完了ゲートと陪審が行い、手で完了にするのはタスク画面から
const String rapiDoneNotAllowedCode = 'done_not_allowed_via_assistant';

/// 条件の状態の表示名（デスクトップ rapiAvatar.bulk.statusLabel と同じ表記）
const Map<String, String> rapiTidyStatusLabels = {
  'cancelled': '中止',
  'done': '完了',
  'blocked': 'ブロック',
  'todo': '未着手',
};

/// 「最終更新」の選択肢（日数。0 は期間を問わない。デスクトップの AGES と同じ）
const List<int> rapiTidyAges = [0, 30, 90, 180];

/// 削除の条件（POST /assistant/delete-filter のボディ）
class TidyFilter {
  /// テーマ（null ならすべてのテーマ）
  final String? themeId;
  final List<String> statuses;

  /// この日数以上更新されていないもの（0 なら期間を問わない）
  final int days;

  /// 初期値はデスクトップと同じ（中止・90日以上前・すべてのテーマ）
  const TidyFilter({this.themeId, this.statuses = const ['cancelled'], this.days = 90});

  TidyFilter copyWith({Object? themeId = _unsetTidy, List<String>? statuses, int? days}) =>
      TidyFilter(
        themeId: identical(themeId, _unsetTidy) ? this.themeId : themeId as String?,
        statuses: statuses ?? this.statuses,
        days: days ?? this.days,
      );

  /// サーバーは状態が空だと「すべての状態」を対象にするので、空では送らせない（デスクトップと同じ）
  bool get canPreview => statuses.isNotEmpty;

  Map<String, dynamic> toJson() {
    final theme = themeId == null ? null : int.tryParse(themeId!);
    return {
      if (theme != null) 'themeId': theme,
      'statuses': statuses.take(10).toList(),
      if (days > 0) 'updatedBeforeDays': days,
    };
  }
}

const Object _unsetTidy = Object();

/// 片付けの候補1件（条件の該当・文章の提案の両方をこの形で持つ）
class TidyItem {
  final String id;
  final String title;
  final String status;

  /// 条件の該当：最終更新日時
  final DateTime? updatedAt;

  /// 文章の提案：消してよいと判断した理由（空のこともある）
  final String reason;

  const TidyItem({
    required this.id,
    required this.title,
    required this.status,
    this.updatedAt,
    this.reason = '',
  });

  /// delete-filter の matches の1件（{id, title, status, updatedAt}）
  factory TidyItem.fromMatch(Map<String, dynamic> json) => TidyItem(
        id: json['id'].toString(),
        title: _string(json['title']) ?? '',
        status: _string(json['status']) ?? '',
        updatedAt: json['updatedAt'] is String ? DateTime.tryParse(json['updatedAt']) : null,
      );

  /// delete-draft の candidates の1件（{id, title, status, themeId, reason}）
  factory TidyItem.fromCandidate(Map<String, dynamic> json) => TidyItem(
        id: json['id'].toString(),
        title: _string(json['title']) ?? '',
        status: _string(json['status']) ?? '',
        reason: (_string(json['reason']) ?? '').trim(),
      );
}

/// POST /assistant/delete-filter の結果
class DeleteFilterResult {
  /// 該当したもの（更新の古い順・最大500件）
  final List<TidyItem> matches;

  /// 該当した総数（一覧の件数を超えることがある）
  final int total;

  /// 総数が一覧に載りきらなかった
  final bool truncated;

  /// 条件に当たったが保護されているため外した件数
  final int excludedProtected;

  const DeleteFilterResult({
    this.matches = const [],
    this.total = 0,
    this.truncated = false,
    this.excludedProtected = 0,
  });

  factory DeleteFilterResult.fromJson(Map<String, dynamic> json) {
    final matches = [
      for (final m in _maps(json['matches']))
        if (m['id'] is num) TidyItem.fromMatch(m),
    ];
    int n(dynamic v, int fallback) => v is num ? v.toInt() : fallback;
    return DeleteFilterResult(
      matches: matches,
      total: n(json['total'], matches.length),
      truncated: json['truncated'] == true,
      excludedProtected: n(json['excludedProtected'], 0),
    );
  }
}

/// POST /assistant/delete-draft の結果
class DeleteDraftResult {
  /// false なら AI に届かなかった（候補が空なのは「消すものが無い」からではない）
  final bool available;
  final List<TidyItem> candidates;

  /// 検討したタスク数（最近更新された最大60件）
  final int considered;

  /// 判断できなかったこと（最大3件）
  final List<String> unclear;

  const DeleteDraftResult({
    this.available = true,
    this.candidates = const [],
    this.considered = 0,
    this.unclear = const [],
  });

  factory DeleteDraftResult.fromJson(Map<String, dynamic> json) => DeleteDraftResult(
        available: json['available'] != false,
        candidates: [
          for (final c in _maps(json['candidates']))
            if (c['id'] is num) TidyItem.fromCandidate(c),
        ],
        considered: json['considered'] is num ? (json['considered'] as num).toInt() : 0,
        unclear: _strings(json['unclear']),
      );
}

/// task-delete の1件の結果（outcome は deleted / protected / not_found / failed）
class TaskDeletion {
  final String taskId;
  final String outcome;

  /// 削除したときのゴミ箱の行（取り消しに使う。控えが書けなかったときは null）
  final int? trashId;

  const TaskDeletion({required this.taskId, required this.outcome, this.trashId});

  bool get deleted => outcome == 'deleted';
}

/// 削除を送った結果。50件ずつ送り、どこかの回が失敗したらそこで止める
class TaskDeleteRun {
  /// サーバーが1件ずつ返した結果（送った順）
  final List<TaskDeletion> results;

  /// 送ったが結果が分からないもの（応答が失われた・5xx・形の異常。サーバーでは削除済みかもしれない）
  final List<String> unknown;

  /// サーバーが回ごと断ったもの（4xx・2xx の success:false。削除していないと言い切れる）
  final List<String> rejected;

  /// 途中で止めたため送っていないもの
  final List<String> unsent;

  const TaskDeleteRun({
    this.results = const [],
    this.unknown = const [],
    this.rejected = const [],
    this.unsent = const [],
  });

  List<TaskDeletion> get deleted => [for (final r in results) if (r.deleted) r];
  List<TaskDeletion> get refused => [for (final r in results) if (!r.deleted) r];

  /// 全件を送り、結果がそろった（一部が保護などで断られていても true）
  bool get complete => unknown.isEmpty && rejected.isEmpty && unsent.isEmpty;
}
