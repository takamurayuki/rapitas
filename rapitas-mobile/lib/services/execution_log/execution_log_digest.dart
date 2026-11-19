/// 実行ログを「利用者に伝えるべき出来事」の並びと「いまの状態」1行に絞る。
///
/// 1行ごとの見分けは execution_log_line_rules.dart。ここはそれを出来事にまとめる
/// （作業の連続を1件に、同じ内容の連続を件数に、質問の二重記録を1件に）。
/// 生ログそのものは捨てない（詳細表示は ExecutionLogSnapshot.entries をそのまま使う）。
library;

import 'execution_log_line_rules.dart';
import 'execution_log_snapshot.dart';
import 'execution_log_state.dart';
import 'execution_log_types.dart';

export 'execution_log_line_rules.dart' show toolLabel;
export 'execution_log_types.dart';

/// 絞り込みの結果
class ExecLogDigest {
  final List<ExecLogEvent> events;

  /// 表に出さなかった内部の行の数（詳細で見られる）
  final int hiddenLines;

  /// 分類できなかったタグ行の数（詳細で見られる）
  final int otherLines;
  final ExecLogState state;

  const ExecLogDigest({required this.events, required this.hiddenLines, required this.otherLines, required this.state});
}

/// 実行ログを出来事と状態に絞る。
///
/// @param snapshot - 取得した実行ログ / 実行ログ
/// @returns 出来事の並び・状態・隠した行数 / 絞り込み結果
ExecLogDigest digestExecutionLog(ExecutionLogSnapshot snapshot) {
  final b = _Builder();
  for (final entry in snapshot.entries) {
    b.addChunk(entry);
  }
  final events = b.events;
  // 質問とエラーは必ず出す：ログに行が無くても、実行に記録された質問・エラーを末尾に足す
  final question = snapshot.question?.trim();
  if (snapshot.status == 'waiting_for_input' && question != null && question.isNotEmpty) {
    if (!events.any((e) => e.kind == ExecLogKind.question && e.body == question)) {
      events.add(ExecLogEvent(ExecLogKind.question, '質問', body: question));
    }
  }
  final error = snapshot.errorMessage?.trim();
  if (snapshot.status == 'failed' && error != null && error.isNotEmpty) {
    if (!events.any((e) => e.kind == ExecLogKind.error && (e.body ?? '').contains(error))) {
      events.add(ExecLogEvent(ExecLogKind.error, 'エラー', body: error));
    }
  }
  return ExecLogDigest(
    events: events,
    hiddenLines: b.hiddenLines,
    otherLines: b.otherLines,
    state: execLogStateOf(snapshot, events),
  );
}

class _Builder {
  final events = <ExecLogEvent>[];
  int hiddenLines = 0;
  int otherLines = 0;

  ExecLogEvent? get _last => events.lastOrNull;

  void addChunk(ExecutionLogEntry entry) {
    final time = entry.timestamp;
    // NOTE: processSystemEvent は1件のエラーを `[System Error: ${errorMsg}]\n` の1回の emit で書き、
    // 1 emit が 1 chunk になる（output-parser-handlers.ts、log-chunk-manager.ts）。外側の閉じ括弧は
    // chunk 末尾の `]` だけなので、行ごとに見ず chunk 全体を1件にする（本文の行末の `]` で切らない）
    final systemError = _systemErrorBody(entry.chunk);
    if (systemError != null) {
      _push(ExecLogEvent(ExecLogKind.error, 'エラー', body: systemError, time: time));
      return;
    }
    // 同じ chunk の中で、タグ行の後に続くタグなしの行をどこへ付けるか
    ExecLogEvent? bodyTarget;
    var bodyToDetail = false;
    final speech = <String>[];

    void flushSpeech() {
      final text = speech.join('\n').trim();
      speech.clear();
      if (text.isEmpty) return;
      if (entry.isStderr) {
        _push(ExecLogEvent(ExecLogKind.error, 'エラー出力', body: text, time: time, count: _lineCount(text)),
            mergeStderr: true);
      } else {
        _push(ExecLogEvent(ExecLogKind.speech, firstLineOf(text), body: text, time: time));
      }
    }

    // chunk の途中から始まる複数行の System Error（記録側には無い形の備え）。chunk の終わりまでを本文にし、
    // 重複のまとめは本文が確定してから判定する
    List<String>? openError;

    for (final raw in entry.chunk.split('\n')) {
      if (openError != null) {
        openError.add(raw);
        continue;
      }
      final line = _classify(raw, entry.isStderr);
      if (line.tag == LineTag.text) {
        if (line.text.isEmpty && bodyTarget == null) {
          if (speech.isNotEmpty) speech.add('');
          continue;
        }
        if (bodyTarget != null) {
          if (line.text.isEmpty) continue;
          if (bodyToDetail) {
            bodyTarget.detail = [bodyTarget.detail, line.text].whereType<String>().join('\n');
          } else {
            bodyTarget.body = [bodyTarget.body, line.text].whereType<String>().where((s) => s.isNotEmpty).join('\n');
          }
        } else {
          speech.add(line.text);
        }
        continue;
      }
      flushSpeech();
      bodyTarget = null;
      bodyToDetail = false;
      switch (line.tag) {
        case LineTag.hidden:
          hiddenLines++;
        case LineTag.other:
          otherLines++;
        case LineTag.workCall:
          _addWorkItem(_work(time), line);
        case LineTag.workDone:
          if (_last?.kind == ExecLogKind.work) {
            final work = _work(time);
            // 呼び出しの行が無い完了（Codex の Command Done だけ等）は、完了の行を項目として数える
            if (work.items.isEmpty && line.text.isNotEmpty) _addWorkItem(work, line);
          } else if (line.text.isNotEmpty) {
            _addWorkItem(_work(time), line);
          } else {
            // NOTE: 発言をはさんで届いた成功の完了だけでは、伝える中身の無い「作業」になる。
            // 呼び出しは前の作業で数え済みなので、内部の記録として詳細に回す
            hiddenLines++;
          }
        case LineTag.workFailed:
          final work = _work(time);
          if (work.items.isEmpty && line.text.isNotEmpty) _addWorkItem(work, line);
          work.failures++;
          work.title = _workTitle(work);
          bodyTarget = work;
          bodyToDetail = true;
        case LineTag.question:
          bodyTarget = _question(line.text.trim(), time);
        case LineTag.result:
          final ok = line.isSuccessResult;
          final title = ok ? '完了' : '失敗（${line.name}）';
          bodyTarget = _push(ExecLogEvent(ok ? ExecLogKind.done : ExecLogKind.error,
              line.duration == null ? title : '$title・${line.duration}',
              time: time));
        case LineTag.error:
          _push(ExecLogEvent(ExecLogKind.error, 'エラー', body: line.text, time: time));
        case LineTag.errorWithBody:
          bodyTarget = _push(ExecLogEvent(ExecLogKind.error, 'エラー（${line.text}）', time: time));
        case LineTag.errorOpen:
          openError = [line.text];
        case LineTag.warning:
          _push(ExecLogEvent(ExecLogKind.warning, firstLineOf(line.text), body: line.text, time: time));
        case LineTag.heartbeat:
          _push(ExecLogEvent(ExecLogKind.milestone, '応答が無いまま処理を続けています', body: line.text, time: time),
              mergeByTitle: true);
        case LineTag.milestone:
          _push(ExecLogEvent(ExecLogKind.milestone, line.text, time: time));
        case LineTag.start:
          _push(ExecLogEvent(ExecLogKind.start, line.text.contains('追加指示') ? '追加指示の実行を開始しました' : '実行を開始しました',
              time: time));
        case LineTag.text:
          break;
      }
    }
    flushSpeech();
    if (openError != null) {
      _push(ExecLogEvent(ExecLogKind.error, 'エラー', body: _stripClosing(openError.join('\n')), time: time));
    }
  }

  void _addWorkItem(ExecLogEvent work, ClassifiedLine line) {
    work.items.add(workItemText(line.name, line.text));
    work.count = work.items.length;
    work.title = _workTitle(work);
  }

  /// 直前が作業ならそれに足し、そうでなければ新しい作業を始める
  ExecLogEvent _work(DateTime? time) {
    final last = _last;
    if (last != null && last.kind == ExecLogKind.work) {
      last.lastTime = time ?? last.lastTime;
      return last;
    }
    final work = ExecLogEvent(ExecLogKind.work, '作業', time: time, count: 0);
    events.add(work);
    return work;
  }

  /// NOTE: Claude は質問を2回記録する（question-detected の chunk と、同じ質問を含む assistant の chunk。
  /// output-parser-handlers.ts）。間に発言が挟まるので「直前と同じ」では拾えない。
  /// 同じ実行の中で、開始を挟まずに同じ文の質問が来たら最初の1件にまとめる。
  ExecLogEvent _question(String text, DateTime? time) {
    for (final e in events.reversed) {
      if (e.kind == ExecLogKind.start) break;
      if (e.kind == ExecLogKind.question && e.body == text) return e;
    }
    return _push(ExecLogEvent(ExecLogKind.question, '質問', body: text, time: time));
  }

  ExecLogEvent _push(ExecLogEvent event, {bool mergeByTitle = false, bool mergeStderr = false}) {
    final last = _last;
    if (last != null && last.kind == event.kind) {
      if (mergeStderr && last.title == event.title) {
        last.body = '${last.body}\n${event.body}';
        last.count += event.count;
        last.lastTime = event.time ?? last.lastTime;
        return last;
      }
      if ((mergeByTitle && last.title == event.title) ||
          (last.title == event.title && last.body == event.body && event.kind != ExecLogKind.done)) {
        last.count++;
        last.body = event.body ?? last.body;
        last.lastTime = event.time ?? last.lastTime;
        return last;
      }
    }
    events.add(event);
    return event;
  }
}

/// stderr でもタグどおりに扱う種類（それ自体がエラーか、必ず出す質問）
const _stderrKeepsTag = {LineTag.text, LineTag.error, LineTag.errorWithBody, LineTag.errorOpen, LineTag.question};

/// NOTE: Codex / Gemini の stderr は、重要な行を行頭のラベルごと残して記録される
/// （cli-output-filter.ts の filterCliDiagnosticOutput。例 `[fatal] permission denied`、`[Command] $ npm test`）。
/// stderr の行はタグの有無にかかわらず「エラー出力」として表に出す。行の文はタグごと残す
ClassifiedLine _classify(String raw, bool isStderr) {
  final line = classifyLogLine(raw);
  if (!isStderr || _stderrKeepsTag.contains(line.tag)) return line;
  return ClassifiedLine(LineTag.text, text: raw.trim());
}

String _workTitle(ExecLogEvent work) {
  final counts = <String, int>{};
  for (final item in work.items) {
    final label = item.split(':').first;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  final parts = counts.entries.map((e) => '${e.key} ${e.value}').join('・');
  if (parts.isEmpty) return work.failures > 0 ? '作業の失敗' : '作業';
  return '作業 ${work.items.length}件（$parts）';
}

final _systemErrorHead = RegExp(r'^\s*\[System Error:\s*');

/// chunk が `[System Error:` で始まるなら、その chunk 全体の本文（末尾の `]` と改行を除く）。それ以外は null
String? _systemErrorBody(String chunk) {
  final m = _systemErrorHead.firstMatch(chunk);
  return m == null ? null : _stripClosing(chunk.substring(m.end));
}

/// 末尾の空白・改行と、外側の閉じ括弧 `]` 1つだけを外す（本文の途中の `]` は残す）
String _stripClosing(String text) {
  final body = text.trimRight();
  return body.endsWith(']') ? body.substring(0, body.length - 1).trimRight() : body;
}

int _lineCount(String text) => text.split('\n').where((l) => l.trim().isNotEmpty).length;
