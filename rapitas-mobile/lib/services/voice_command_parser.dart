/// 音声コマンドの種別
enum VoiceCommandType {
  createTask,
  approveRequest,
  rejectRequest,
  executeTask,
  unknown,
}

/// 解析された音声コマンド
class VoiceCommand {
  final VoiceCommandType type;
  final String rawText;
  final Map<String, String> parameters;

  const VoiceCommand({
    required this.type,
    required this.rawText,
    this.parameters = const {},
  });

  String? get title => parameters['title'];
  String? get priority => parameters['priority'];
  String? get description => parameters['description'];
  String? get targetId => parameters['targetId'];
  String? get reason => parameters['reason'];

  String get typeLabel {
    switch (type) {
      case VoiceCommandType.createTask:
        return 'タスク作成';
      case VoiceCommandType.approveRequest:
        return '承認';
      case VoiceCommandType.rejectRequest:
        return '却下';
      case VoiceCommandType.executeTask:
        return '自動実行';
      case VoiceCommandType.unknown:
        return '不明';
    }
  }
}

/// 音声入力テキストをコマンドに解析するパーサー
class VoiceCommandParser {
  // タスク作成パターン
  static final _createPatterns = [
    RegExp(r'タスク(?:を)?(?:作成|追加|登録)(?:して)?(?:\s*[、。]?\s*)(.+)', caseSensitive: false),
    RegExp(r'(?:新しい)?タスク\s*[、。:：]\s*(.+)', caseSensitive: false),
    RegExp(r'(.+?)(?:を|の)タスク(?:を)?(?:作成|追加|登録)', caseSensitive: false),
    RegExp(r'(?:作成|追加|登録)(?:して)?\s*[、。:：]?\s*(.+)', caseSensitive: false),
  ];

  // 承認パターン
  static final _approvePatterns = [
    RegExp(r'(?:承認|許可|OK|オッケー)(?:して|する)?', caseSensitive: false),
    RegExp(r'(?:これ(?:を)?)?承認', caseSensitive: false),
  ];

  // 却下パターン
  static final _rejectPatterns = [
    RegExp(r'(?:却下|拒否|リジェクト)(?:して|する)?(?:\s*[、。]?\s*)(?:理由[はが]?\s*)?(.+)?', caseSensitive: false),
    RegExp(r'(?:これ(?:を)?)?却下', caseSensitive: false),
  ];

  // 自動実行パターン
  static final _executePatterns = [
    RegExp(r'(?:実行|自動実行|エージェント実行|AI実行)(?:して|する)?', caseSensitive: false),
    RegExp(r'(?:これ(?:を)?)?(?:実行|自動実行)', caseSensitive: false),
    RegExp(r'(.+?)(?:を)(?:実行|自動実行)', caseSensitive: false),
  ];

  // 優先度キーワード
  static final _priorityMap = {
    '緊急': 'urgent',
    '至急': 'urgent',
    '高': 'high',
    '高い': 'high',
    '高め': 'high',
    '中': 'medium',
    '普通': 'medium',
    '低': 'low',
    '低い': 'low',
    '低め': 'low',
  };

  /// テキストを解析してVoiceCommandを返す
  VoiceCommand parse(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      return VoiceCommand(type: VoiceCommandType.unknown, rawText: text);
    }

    // 承認コマンドの検出
    for (final pattern in _approvePatterns) {
      if (pattern.hasMatch(trimmed)) {
        return VoiceCommand(
          type: VoiceCommandType.approveRequest,
          rawText: text,
        );
      }
    }

    // 却下コマンドの検出
    for (final pattern in _rejectPatterns) {
      final match = pattern.firstMatch(trimmed);
      if (match != null) {
        final reason = match.groupCount > 0 ? match.group(1)?.trim() : null;
        return VoiceCommand(
          type: VoiceCommandType.rejectRequest,
          rawText: text,
          parameters: {
            if (reason != null && reason.isNotEmpty) 'reason': reason,
          },
        );
      }
    }

    // 実行コマンドの検出
    for (final pattern in _executePatterns) {
      if (pattern.hasMatch(trimmed)) {
        return VoiceCommand(
          type: VoiceCommandType.executeTask,
          rawText: text,
        );
      }
    }

    // タスク作成コマンドの検出
    for (final pattern in _createPatterns) {
      final match = pattern.firstMatch(trimmed);
      if (match != null && match.groupCount > 0) {
        final content = match.group(1)?.trim() ?? '';
        if (content.isNotEmpty) {
          final parsed = _parseTaskContent(content);
          return VoiceCommand(
            type: VoiceCommandType.createTask,
            rawText: text,
            parameters: parsed,
          );
        }
      }
    }

    // どのパターンにも一致しない場合、テキスト全体をタスクタイトルとして扱う
    // （タスク画面からの音声入力はタスク作成として扱う）
    return VoiceCommand(
      type: VoiceCommandType.createTask,
      rawText: text,
      parameters: {'title': trimmed},
    );
  }

  /// タスクコンテンツから優先度やタイトルを抽出
  Map<String, String> _parseTaskContent(String content) {
    final params = <String, String>{};
    var title = content;

    // 優先度の抽出
    for (final entry in _priorityMap.entries) {
      final priorityPattern = RegExp('(?:優先度|優先)[はがを]?${entry.key}');
      if (priorityPattern.hasMatch(title)) {
        params['priority'] = entry.value;
        title = title.replaceAll(priorityPattern, '').trim();
        break;
      }
    }

    // 末尾の句読点を除去
    title = title.replaceAll(RegExp(r'[、。]+$'), '').trim();

    if (title.isNotEmpty) {
      params['title'] = title;
    }

    return params;
  }
}
