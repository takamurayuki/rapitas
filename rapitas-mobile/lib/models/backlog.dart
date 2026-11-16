// バックログ（アイデア／懸念／仮説）のモデルと表示ラベル。
// 契約はデスクトップ（rapitas-backend routes/memory/{idea-box,concern-backlog,hypothesis}.ts）。

/// 優先度（アイデア）・重要度（懸念）の値。どちらも同じ4段階。
const List<String> backlogPriorityOrder = ['urgent', 'high', 'medium', 'low'];

/// アイデアの優先度ラベル
const Map<String, String> ideaPriorityLabels = {
  'urgent': '緊急',
  'high': '高',
  'medium': '中',
  'low': '低',
};

/// 懸念の種別ラベル
const Map<String, String> concernTypeLabels = {
  'bug': 'バグ',
  'refactor': 'リファクタ',
  'security': 'セキュリティ',
  'perf': 'パフォーマンス',
  'other': 'その他',
};

/// 懸念の重要度ラベル
const Map<String, String> concernSeverityLabels = {
  'urgent': '緊急',
  'high': '高',
  'medium': '中',
  'low': '低',
};

/// 懸念の状態ラベル
const Map<String, String> concernStatusLabels = {
  'open': '未対応',
  'task_created': 'タスク化済',
  'dismissed': '却下',
  'resolved': '解決済み',
};

/// 仮説の状態ラベル（デスクトップの表記に合わせる）
const Map<String, String> hypothesisStatusLabels = {
  'open': '検証待ち',
  'supported': '立証済み',
  'refuted': '反証済み',
  'inconclusive': '結論保留',
};

DateTime? _parseDate(dynamic value) =>
    value is String ? DateTime.tryParse(value) : null;

String _string(dynamic value, [String fallback = '']) =>
    value == null ? fallback : value.toString();

/// アイデア（GET /idea-box の ideas[]）
class Idea {
  final String id;
  final String title;
  final String content;

  /// urgent / high / medium / low
  final String priority;

  /// global / project
  final String scope;
  final String? themeId;
  final String? usedInTaskId;
  final DateTime? createdAt;

  const Idea({
    required this.id,
    required this.title,
    required this.content,
    required this.priority,
    required this.scope,
    this.themeId,
    this.usedInTaskId,
    this.createdAt,
  });

  factory Idea.fromJson(Map<String, dynamic> json) {
    return Idea(
      id: json['id'].toString(),
      title: _string(json['title']),
      content: _string(json['content']),
      priority: _string(json['priority'], 'medium'),
      scope: _string(json['scope'], 'global'),
      themeId: json['themeId']?.toString(),
      usedInTaskId: json['usedInTaskId']?.toString(),
      createdAt: _parseDate(json['createdAt']),
    );
  }
}

/// 懸念（GET /concerns の concerns[]）
class Concern {
  final String id;
  final String title;
  final String detail;

  /// bug / refactor / security / perf / other
  final String type;

  /// urgent / high / medium / low
  final String severity;

  /// open / task_created / dismissed / resolved
  final String status;
  final String? location;
  final String? themeId;
  final DateTime? createdAt;

  const Concern({
    required this.id,
    required this.title,
    required this.detail,
    required this.type,
    required this.severity,
    required this.status,
    this.location,
    this.themeId,
    this.createdAt,
  });

  factory Concern.fromJson(Map<String, dynamic> json) {
    return Concern(
      id: json['id'].toString(),
      title: _string(json['title']),
      detail: _string(json['detail']),
      type: _string(json['type'], 'other'),
      severity: _string(json['severity'], 'medium'),
      status: _string(json['status'], 'open'),
      location: json['location']?.toString(),
      themeId: json['themeId']?.toString(),
      createdAt: _parseDate(json['createdAt']),
    );
  }
}

/// 仮説の証拠1件
class HypothesisEvidence {
  /// for / against
  final String stance;
  final String detail;
  final String artifact;

  const HypothesisEvidence({
    required this.stance,
    required this.detail,
    required this.artifact,
  });

  factory HypothesisEvidence.fromJson(Map<String, dynamic> json) {
    return HypothesisEvidence(
      stance: _string(json['stance']),
      detail: _string(json['detail']),
      artifact: _string(json['artifact']),
    );
  }
}

/// 仮説（GET /hypotheses の hypotheses[]）。エージェントが起票するのでモバイルからは作らない。
class Hypothesis {
  final String id;
  final String statement;
  final String rationale;
  final String domain;

  /// open / supported / refuted / inconclusive
  final String status;

  /// 確信度 0〜1
  final double confidence;
  final List<HypothesisEvidence> evidence;
  final String? themeId;
  final DateTime? createdAt;

  const Hypothesis({
    required this.id,
    required this.statement,
    required this.rationale,
    required this.domain,
    required this.status,
    required this.confidence,
    this.evidence = const [],
    this.themeId,
    this.createdAt,
  });

  /// 確信度のパーセント表示用の整数（0〜100 に収める）
  int get confidencePercent => (confidence * 100).round().clamp(0, 100);

  factory Hypothesis.fromJson(Map<String, dynamic> json) {
    final rawEvidence = json['evidence'];
    final confidence = json['confidence'];
    return Hypothesis(
      id: json['id'].toString(),
      statement: _string(json['statement']),
      rationale: _string(json['rationale']),
      domain: _string(json['domain']),
      status: _string(json['status'], 'open'),
      confidence: confidence is num ? confidence.toDouble() : 0,
      evidence: rawEvidence is List
          ? rawEvidence
              .whereType<Map>()
              .map((e) => HypothesisEvidence.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const [],
      themeId: json['themeId']?.toString(),
      createdAt: _parseDate(json['createdAt']),
    );
  }
}
