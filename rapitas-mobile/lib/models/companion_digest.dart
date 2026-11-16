/// 伴走の要約（GET /assistant/companion/digest）。ラピ伴走化 第2段階-1。
///
/// バックエンドがモデルを使わずに数えた値をそのまま持つ。文にするのは utils/plain_reasons.dart。
library;

/// 前回から起きた出来事1件
class DigestEvent {
  final int id;

  /// halted / review_held / question / repair / replanned / plan_ready / decided / completed / progress
  final String kind;
  final String toStatus;
  final DateTime? at;

  const DigestEvent({required this.id, required this.kind, required this.toStatus, this.at});

  factory DigestEvent.fromJson(Map<String, dynamic> json) => DigestEvent(
        id: (json['id'] as num).toInt(),
        kind: json['kind'] as String? ?? 'progress',
        toStatus: json['toStatus'] as String? ?? '',
        at: DateTime.tryParse(json['at'] as String? ?? '')?.toLocal(),
      );
}

/// あなたが決めること（無ければ null）
class DigestDecision {
  /// approve_plan / answer_question / review_hold / release_halt
  final String kind;
  final String? haltReason;
  final String? holdReason;

  /// 判断する画面（このアプリのルート。例: /tasks/42/decide）
  final String link;

  const DigestDecision({required this.kind, required this.link, this.haltReason, this.holdReason});

  factory DigestDecision.fromJson(Map<String, dynamic> json, String taskId) => DigestDecision(
        kind: json['kind'] as String? ?? '',
        haltReason: json['haltReason'] as String?,
        holdReason: json['holdReason'] as String?,
        link: json['link'] as String? ?? '/tasks/$taskId/decide',
      );
}

/// 伴走中のタスク1件の要約
class DigestItem {
  final String taskId;
  final String title;
  final String? workflowStatus;
  final String? haltReason;

  /// 前回からの動きの件数（表示する遷移の数）と、そのうちの差し戻し・質問・停止など
  final int transitions;
  final int repairs;
  final int questions;
  final int halts;
  final int holds;
  final int replans;

  /// 新しい順の出来事（最大5件）
  final List<DigestEvent> recent;

  /// 今の修復の集計窓での差し戻しの回数と、いちばん多い原因
  final int repairTotal;
  final String? repairTopCause;

  final DigestDecision? decision;

  /// 「ここまで見せた」と返す遷移の id。新しい動きが無ければ null
  final int? cursor;

  const DigestItem({
    required this.taskId,
    required this.title,
    this.workflowStatus,
    this.haltReason,
    this.transitions = 0,
    this.repairs = 0,
    this.questions = 0,
    this.halts = 0,
    this.holds = 0,
    this.replans = 0,
    this.recent = const [],
    this.repairTotal = 0,
    this.repairTopCause,
    this.decision,
    this.cursor,
  });

  factory DigestItem.fromJson(Map<String, dynamic> json) {
    final taskId = '${json['taskId']}';
    final since = (json['since'] as Map?)?.cast<String, dynamic>() ?? const {};
    final repairs = (json['repairs'] as Map?)?.cast<String, dynamic>() ?? const {};
    int n(Map<String, dynamic> m, String k) => (m[k] as num?)?.toInt() ?? 0;
    final decision = json['decision'];
    return DigestItem(
      taskId: taskId,
      title: json['title'] as String? ?? '',
      workflowStatus: json['workflowStatus'] as String?,
      haltReason: json['haltReason'] as String?,
      transitions: n(since, 'transitions'),
      repairs: n(since, 'repairs'),
      questions: n(since, 'questions'),
      halts: n(since, 'halts'),
      holds: n(since, 'holds'),
      replans: n(since, 'replans'),
      recent: [
        for (final e in (json['recent'] as List? ?? const []))
          DigestEvent.fromJson((e as Map).cast<String, dynamic>()),
      ],
      repairTotal: n(repairs, 'total'),
      repairTopCause: repairs['topCause'] as String?,
      decision: decision is Map
          ? DigestDecision.fromJson(decision.cast<String, dynamic>(), taskId)
          : null,
      cursor: (json['cursor'] as num?)?.toInt(),
    );
  }
}

/// 要約全体
class CompanionDigest {
  final List<DigestItem> items;
  final int decisionCount;

  const CompanionDigest({this.items = const [], this.decisionCount = 0});

  bool get isEmpty => items.isEmpty;

  factory CompanionDigest.fromJson(Map<String, dynamic> json) {
    final items = [
      for (final i in (json['items'] as List? ?? const []))
        DigestItem.fromJson((i as Map).cast<String, dynamic>()),
    ];
    return CompanionDigest(
      items: items,
      decisionCount:
          (json['decisionCount'] as num?)?.toInt() ?? items.where((i) => i.decision != null).length,
    );
  }
}

/// いまの列の値から「あなたが決めること」の種類を出す（バックエンド companion-digest.ts の decisionFor と同じ順）。
/// 判断画面は要約を経ずに開かれることもある（タスク詳細・ディープリンク）ので、画面側でも同じ規則で決める
String? decisionKindFor({required String status, String? workflowStatus, String? haltReason}) {
  if (status == 'done') return null;
  final halt = haltReason?.trim();
  if (halt == 'awaiting_review_decision' && workflowStatus == 'verify_done') return 'review_hold';
  if (halt != null && halt.isNotEmpty && halt != 'awaiting_review_decision') return 'release_halt';
  if (workflowStatus == 'awaiting_question') return 'answer_question';
  if (workflowStatus == 'plan_created') return 'approve_plan';
  return null;
}
