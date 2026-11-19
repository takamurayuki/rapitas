/// 実行ログを「利用者に伝えるべき出来事」の並びと「いまの状態」1行に絞る。
///
/// 1行ごとの見分けは execution_log_line_rules.dart。ここはそれを出来事にまとめる
/// （作業の連続を1件に、同じ内容の連続を件数に、質問の二重記録を1件に）。
/// 生ログそのものは捨てない（詳細表示は ExecutionLogSnapshot.entries をそのまま使う）。
library;

import 'execution_log_line_rules.dart';
import 'execution_log_snapshot.dart';

export 'execution_log_line_rules.dart' show toolLabel;

/// 出来事の種類
enum ExecLogKind { start, speech, work, question, warning, error, done, milestone }

/// タイムラインの1件
class ExecLogEvent {
  final ExecLogKind kind;
  String title;

  /// 全文（長ければ表示側で先頭だけ出し、タップで広げる）
  String? body;
  final DateTime? time;
  DateTime? lastTime;

  /// 同じ内容の連続の件数。作業なら操作の件数、stderr ならまとめた行数
  int count;

  /// 作業の項目（ツール呼び出し1件 = 1項目）
  final List<String> items = [];

  /// 作業のうち失敗した件数
  int failures = 0;

  /// 作業の失敗時に記録された出力（Codex の Command Failed の末尾）
  String? detail;

  ExecLogEvent(this.kind, this.title, {this.body, this.time, this.count = 1}) : lastTime = time;
}

/// 「いまの状態」の区分
enum ExecLogPhase { running, waiting, error, done, stopped, interrupted, idle }

/// 画面上部の1行
class ExecLogState {
  final ExecLogPhase phase;
  final String label;
  final String? description;

  const ExecLogState(this.phase, this.label, [this.description]);
}

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
    state: _stateOf(snapshot, events),
  );
}

class _Builder {
  final events = <ExecLogEvent>[];
  int hiddenLines = 0;
  int otherLines = 0;

  ExecLogEvent? get _last => events.lastOrNull;

  void addChunk(ExecutionLogEntry entry) {
    final time = entry.timestamp;
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
        _push(ExecLogEvent(ExecLogKind.speech, _firstLine(text), body: text, time: time));
      }
    }

    for (final raw in entry.chunk.split('\n')) {
      final line = classifyLogLine(raw);
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
        case LineTag.warning:
          _push(ExecLogEvent(ExecLogKind.warning, _firstLine(line.text), body: line.text, time: time));
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

String _firstLine(String text) => text.trim().split('\n').first.trim();

int _lineCount(String text) => text.split('\n').where((l) => l.trim().isNotEmpty).length;

ExecLogState _stateOf(ExecutionLogSnapshot s, List<ExecLogEvent> events) {
  String? lastOf(ExecLogKind kind) {
    final e = events.lastWhere((e) => e.kind == kind, orElse: () => ExecLogEvent(kind, ''));
    final text = e.body ?? (e.title.isEmpty ? null : e.title);
    return text == null || text.isEmpty ? null : _firstLine(text);
  }

  switch (s.status) {
    case 'waiting_for_input':
      return ExecLogState(ExecLogPhase.waiting, '入力待ち', s.question ?? lastOf(ExecLogKind.question) ?? '回答を待っています');
    case 'failed':
      return ExecLogState(ExecLogPhase.error, 'エラー', s.errorMessage ?? lastOf(ExecLogKind.error));
    case 'completed':
      return ExecLogState(ExecLogPhase.done, '完了', lastOf(ExecLogKind.done) ?? '実行が完了しました');
    case 'cancelled':
      return const ExecLogState(ExecLogPhase.stopped, '停止', '実行を停止しました');
    case 'interrupted':
      return ExecLogState(ExecLogPhase.interrupted, '中断', s.errorMessage ?? '中断されています（再開できます）');
    case 'running':
    case 'pending':
      return ExecLogState(ExecLogPhase.running, '実行中', _nowDoing(events));
    default:
      return events.isEmpty
          ? const ExecLogState(ExecLogPhase.idle, '記録なし', 'ログはまだありません')
          : ExecLogState(ExecLogPhase.idle, '状態不明', _nowDoing(events));
  }
}

/// 実行中の「いま何をしているか」：最後の出来事から短く作る
String _nowDoing(List<ExecLogEvent> events) {
  final last = events.lastOrNull;
  if (last == null) return '準備しています';
  return switch (last.kind) {
    ExecLogKind.work => last.items.isEmpty ? '作業しています' : last.items.last,
    ExecLogKind.speech => _firstLine(last.body ?? last.title),
    ExecLogKind.start => '開始しました',
    _ => _firstLine(last.body ?? last.title),
  };
}
