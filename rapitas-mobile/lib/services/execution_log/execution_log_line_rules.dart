/// 実行ログの1行を、バックエンドが付けるタグで見分ける規則。
///
/// 規則は記録側の書式を実測したもの（rapitas-backend の workers/output-parser-handlers.ts、
/// claude-code/*.ts、codex-cli-agent/*.ts、gemini-cli-agent/*.ts、orchestrator/fallback-executor.ts）。
/// タグはワイヤー上の約束で UI 文言ではないので、訳さずそのまま照合する。
/// 行どうしをまとめる処理は execution_log_digest.dart が持つ。
library;

/// 行の種類
enum LineTag {
  /// タグなし（エージェントの発言、または直前のタグ行の続き）
  text,
  start,
  question,
  workCall,
  workDone,
  workFailed,
  result,
  error,

  /// 続く行を本文として持つエラー（Codex の終了コード）
  errorWithBody,

  /// 本文が次の行へ続く `[System Error: …`（閉じ括弧の行までが本文）
  errorOpen,
  warning,

  /// 「N秒経過」の生存表示
  heartbeat,
  milestone,

  /// 内部の記録（起動設定・System イベント・回答待ちの表示など）。詳細でだけ見せる
  hidden,

  /// 分類できないタグ。詳細でだけ見せる
  other,
}

/// 分類した1行
class ClassifiedLine {
  final LineTag tag;

  /// 出来事の本文や見出しに使う部分（タグを除いたもの）
  final String text;

  /// 作業の行ならツール名、Result なら subtype
  final String? name;

  /// Result の所要時間（"95.2s" など）
  final String? duration;

  const ClassifiedLine(this.tag, {this.text = '', this.name, this.duration});

  /// Result の subtype が成功を表すか
  bool get isSuccessResult => name == 'success' || name == 'completed';
}

// 先頭の [エージェント名]。名前は AIエージェント設定の name なので任意の文字列になる（base-agent.ts の logPrefix）
const _agent = r'^\[[^\]\n]+\]\s*';

final List<(RegExp, ClassifiedLine Function(RegExpMatch m))> _rules = [
  (RegExp(r'^\[(?:Question|質問)\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.question, text: m[1]!)),
  (
    RegExp(r'^\[Tool Error(?::\s*([^\]]+))?[^\]]*\]'),
    (m) => ClassifiedLine(LineTag.workFailed, name: m[1]?.trim()),
  ),
  (RegExp(r'^\[Tool Done(?::\s*([^\]]+))?[^\]]*\]'), (m) => ClassifiedLine(LineTag.workDone, name: m[1]?.trim())),
  (RegExp(r'^\[Tool:\s*([^\]]+)\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.workCall, name: m[1]!.trim(), text: m[2]!)),
  (
    RegExp(r'^\[Command\]\s*(.*?)(?:\s*を開始しました)?$'),
    (m) => ClassifiedLine(LineTag.workCall, name: 'Bash', text: m[1]!),
  ),
  (RegExp(r'^\[Command Done\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.workDone, name: 'Bash', text: m[1]!)),
  (RegExp(r'^\[Command Failed\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.workFailed, name: 'Bash', text: m[1]!)),
  (
    RegExp(r'^\[Result:\s*([\w-]+)(?:\s*\(([^)]*)\))?[^\]]*\]'),
    (m) => ClassifiedLine(LineTag.result, name: m[1], duration: m[2]),
  ),
  (RegExp(r'^\[System Error:\s*(.*)\]\s*$'), (m) => ClassifiedLine(LineTag.error, text: m[1]!)),
  // NOTE: errorMsg は CLI の JSON の message そのままで改行を含みうる（output-parser-handlers.ts の
  // `[System Error: ${errorMsg}]\n`）。1行目に閉じ括弧が無ければ、続く行を本文として持つ
  (RegExp(r'^\[System Error:\s*(.*)$'), (m) => ClassifiedLine(LineTag.errorOpen, text: m[1]!)),
  (RegExp(r'^\[(?:Error|エラー)\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.error, text: m[1]!)),
  (RegExp(r'^\[Timeout\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.error, text: m[1]!)),
  (RegExp(r'^\[Codex 終了コード (\d+)\]'), (m) => ClassifiedLine(LineTag.errorWithBody, text: '終了コード ${m[1]}')),
  // 「N秒経過」は無応答の間に繰り返し出る生存表示（idle-monitor.ts / process-runner.ts / stream-handler.ts）
  (
    RegExp(r'^\[(?:情報|Warning|警告)\]\s*(\d+\s*(?:秒経過|seconds elapsed).*)$'),
    (m) => ClassifiedLine(LineTag.heartbeat, text: m[1]!),
  ),
  (RegExp(r'^\[(?:Warning|警告|フォールバック|ヒント)\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.warning, text: m[1]!)),
  (RegExp(r'^\[情報\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.hidden, text: m[1]!)),
  (RegExp(r'^\[(?:継続実行|実行開始)\]\s*(.*)$'), (m) => ClassifiedLine(LineTag.start, text: m[1]!)),
  (RegExp('${_agent}Starting execution'), (m) => const ClassifiedLine(LineTag.start)),
  (RegExp('${_agent}Execution resumed'), (m) => const ClassifiedLine(LineTag.milestone, text: '再開しました')),
  (RegExp('${_agent}Execution paused'), (m) => const ClassifiedLine(LineTag.milestone, text: '一時停止しました')),
  (RegExp('${_agent}Stopping execution'), (m) => const ClassifiedLine(LineTag.milestone, text: '停止を要求しました')),
  (RegExp('$_agent(?:Waiting for answer|回答を待っています)'), (m) => const ClassifiedLine(LineTag.hidden)),
  (RegExp('${_agent}Error:\\s*(.*)\$'), (m) => ClassifiedLine(LineTag.error, text: m[1]!)),
  (RegExp('$_agent(?:Execution )?timed out.*\$'), (m) => ClassifiedLine(LineTag.error, text: m[0]!)),
  (RegExp('${_agent}Process has been unresponsive.*\$'), (m) => ClassifiedLine(LineTag.error, text: m[0]!)),
  (
    RegExp('$_agent(?:Model|Working directory|Timeout|Prompt|Process PID):'),
    (m) => const ClassifiedLine(LineTag.hidden),
  ),
  (RegExp(r'^\[System:\s*[^\]]*\]'), (m) => const ClassifiedLine(LineTag.hidden)),
  (RegExp(r'^\[エージェント\]'), (m) => const ClassifiedLine(LineTag.hidden)),
  (RegExp(r'^\[[^\]\n]+\]'), (m) => const ClassifiedLine(LineTag.other)),
];

/// 1行を分類する（前後の空白は除いて照合する）。
///
/// @param line - chunk を改行で分けた1行 / ログの1行
/// @returns 分類結果。どのタグにも当たらなければ [LineTag.text] / 分類した行
ClassifiedLine classifyLogLine(String line) {
  final trimmed = line.trim();
  for (final (pattern, build) in _rules) {
    final m = pattern.firstMatch(trimmed);
    if (m != null) return build(m);
  }
  return ClassifiedLine(LineTag.text, text: trimmed);
}

const _toolLabels = {
  'Read': '読み取り',
  'Write': '書き込み',
  'Edit': '編集',
  'MultiEdit': '編集',
  'NotebookEdit': '編集',
  'Bash': 'コマンド',
  'Glob': '検索',
  'Grep': '検索',
  'WebSearch': 'Web検索',
  'WebFetch': 'Web取得',
  'Task': 'サブエージェント',
  'Agent': 'サブエージェント',
  'TodoWrite': 'ToDo更新',
  'LSP': 'コード解析',
};

/// ツール名を利用者向けの短い呼び名にする（知らない名前はそのまま）。
///
/// @param tool - ツール名 / ツール名
/// @returns 呼び名 / 表示名
String toolLabel(String? tool) => _toolLabels[tool] ?? (tool == null || tool.isEmpty ? '操作' : tool);

/// 作業の1項目の文（「編集: login_screen.dart」など）。
///
/// @param tool - ツール名 / ツール名
/// @param info - タグの後ろの説明（`-> file`、`$ cmd`、`pattern: x` など） / ツールの説明
/// @returns 表示用の文 / 項目の文
String workItemText(String? tool, String info) {
  final cleaned = info.replaceFirst(RegExp(r'^(?:->\s*|\$\s*|pattern:\s*)'), '').trim();
  return cleaned.isEmpty ? toolLabel(tool) : '${toolLabel(tool)}: $cleaned';
}
