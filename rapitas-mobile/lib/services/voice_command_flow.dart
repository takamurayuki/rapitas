import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/approval_request.dart';
import '../models/backlog.dart';
import '../models/task.dart';
import '../models/task_execution.dart';
import '../providers/approval_provider.dart';
import '../providers/backlog_provider.dart';
import '../providers/execution_provider.dart';
import '../providers/rapi_chat_provider.dart';
import '../providers/service_providers.dart';
import '../providers/task_provider.dart';
import '../providers/theme_data_provider.dart';
import '../providers/voice_learning_provider.dart';
import '../providers/voice_provider.dart';
import '../screens/task_form/task_form_screen.dart' show buildTaskFormBody;
import 'backlog_service.dart';
import 'dictation_service.dart';
import 'voice_command_parser.dart';
import 'voice_learning_store.dart';
import 'voice_target_resolver.dart';

// 音声コマンドの流れ（聞き取り → 解釈 → 対象の指定 → 確認 → 実行 → 結果）。
//
// シート（VoiceInputSheet）はこの状態を表示するだけで、流れはここに置く。
// 複数ターン（対象の選択・はい／いいえ・タイトルなどの聞き取り）は、答えを待つ Future で書く。
// 答えは声でもタップでも同じ入口（answer）に入る。
// データの取得・変更は各画面が使っているプロバイダ／サービスをそのまま使う（新しい API は無い）。
// 画面の移動・シートを閉じる・スナックバーなど、シートの外のことは VoiceUi 経由で行う。
//
// 入口は3つ：
// - start()：シートを開いて聞き取りから始める（聞き取り表示のタップ）
// - start(initialText:)：音声操作モードの常時聞き取りで確定した文を、解釈済みの状態から続ける（シートあり）
// - runDirect()：常時聞き取りの文を、シートを開かずにそのまま実行する（移動・スクロール・検索・絞り込みなど）。
//   途中で聞き返し・確認・選択が要ると分かったら、何も変えずに止めて「シートが要る」と返す

/// シートの段階
enum VoiceFlowPhase {
  /// 聞き取り中（コマンド）
  listening,

  /// 声を聞き取れなかった（「もう一度話す」で聞き直す）
  heardNothing,

  /// 候補を番号で選ぶ
  choosing,

  /// はい／いいえ
  confirming,

  /// 項目（タイトル・テーマ・優先度など）を聞いている
  asking,

  /// 実行中
  running,

  /// 成功（少しして閉じる）
  done,

  /// 失敗（理由を出す。勝手にリトライしない）
  failed,

  /// コマンドとして理解できなかった（ラピへ送るか選べる）
  notUnderstood,

  /// 使えるコマンドの一覧
  help,

  /// 途中でやめた
  cancelled,
}

/// シートの外の操作。アプリでは GoRouter・ScaffoldMessenger、テストでは偽物
abstract class VoiceUi {
  /// シートが開いたとき、そのルートを渡す（closeSheet で閉じる対象）
  void attachSheet(Route<dynamic> route);

  /// 音声シートを閉じる
  void closeSheet();

  /// 下タブの画面へ切り替える
  void go(String path);

  /// 画面を積んで開く
  void push(String path, {Object? extra});

  /// 1つ前の画面へ戻る。戻れなければ false
  bool back();

  /// いちばん上のシート・ダイアログを閉じる。閉じるものが無ければ false
  bool closePopup();

  /// [path] の画面の一覧を動かす。受け口が無ければ false
  bool scroll(String path, {required bool down});

  /// [path] の画面を再読み込みする（引っ張って更新・「再試行」の代わり）。更新できるものが無ければ false
  bool refresh(String path);

  /// 短い結果表示（スナックバー）。シートを閉じた後も残る
  void showMessage(String message);
}

/// タスク一覧が「いま見えているタスク」を教える受け口（検索中は検索結果）。
/// 一覧が無いときは null（taskListProvider から取る）
class VoiceTaskListHook {
  static List<Task>? Function()? visibleTasks;
}

class _Stop implements Exception {}

class _Cancelled implements Exception {}

/// シートなしの実行で、聞き返し・確認・選択が要るところまで来た
class _NeedsSheet implements Exception {}

class _Failure implements Exception {
  final String message;
  _Failure(this.message);
}

class VoiceCommandFlow extends ChangeNotifier {
  VoiceCommandFlow({
    required this.path,
    required this.dictation,
    required this.container,
    required this.ui,
    VoiceCommandParser? parser,
    this.actionDelay = const Duration(milliseconds: 450),
    this.closeDelay = const Duration(milliseconds: 1500),
  }) : parser = parser ?? VoiceCommandParser();

  /// 話し始めたときの画面のパス
  final String path;
  final DictationService dictation;
  final ProviderContainer container;
  final VoiceUi ui;
  final VoiceCommandParser parser;

  /// 画面の操作（移動など）の前に、解釈したコマンドを見せておく時間
  final Duration actionDelay;

  /// 成功したあと、シートを閉じるまでの時間
  final Duration closeDelay;

  VoiceScreen get screen => voiceScreenOf(path);

  // ---- 表示用の状態 ----

  VoiceFlowPhase phase = VoiceFlowPhase.listening;

  /// マイクが開いているか
  bool listening = false;

  /// 認識した文（途中経過を含む）
  String heard = '';

  /// 解釈したコマンド（「承認（2番目）」など）
  String? interpretation;

  /// 対象の決め方（「指定がないので先頭の…」など）
  String? note;

  /// 質問・案内・結果の文
  String prompt = '';

  /// 番号で選べる候補（choosing・asking で出す）
  List<String> choices = const [];

  /// help で出す一覧
  List<String> helpLines = const [];

  /// 理解できなかった文（ラピへ送る候補）
  String? unknownText;

  // ---- 内部 ----

  Completer<String?>? _answer;

  /// 聞き取れなかったときに戻る段階
  VoiceFlowPhase _listenPhase = VoiceFlowPhase.listening;
  String _listenPrompt = '';
  bool _keepView = false;
  int _session = 0;

  /// この聞き取りで言葉が届いたか（前の文を答えとして使い回さないため）
  bool _gotWords = false;
  bool _disposed = false;
  bool _started = false;
  bool _sheetClosed = false;
  Timer? _closeTimer;

  /// 対象を「指定なし → 先頭」で決めたか（確認の要らない操作でも確認する）
  bool _defaulted = false;

  /// 聞き間違いの学習の記帳（記録の候補・適用した補正）。成功の地点でだけ確定する
  late final VoiceLearningTurn _learning = VoiceLearningTurn(container);

  /// 学習した補正で対象を決めたことを、結果のスナックバーに添える文
  String? _correctionNotice;

  /// 補正で対象を決めたか。_defaulted と同じく、確認の要らない操作でも確認する（設計 §3.3）
  bool get _corrected => _learning.corrected;

  /// 「ラピに送るか」にどちらとも取れない答えが続いた回数
  int _rapiAsks = 0;

  /// シートなしで実行している（runDirect）
  bool _direct = false;

  /// シートを開かずにそのまま実行できるコマンドか（画面の移動・スクロール・検索・絞り込み・開く）。
  /// データを変えるもの・聞き返しが要るもの・ヘルプはシートで行う。
  /// NOTE: ここに入っていても、対象の選択や確認が要ると分かったら runDirect がシートへ回す
  static bool runsDirectly(VoiceCommand command) => const {
        VoiceCommandType.navigate,
        VoiceCommandType.back,
        VoiceCommandType.close,
        VoiceCommandType.scrollDown,
        VoiceCommandType.scrollUp,
        VoiceCommandType.refresh,
        VoiceCommandType.searchTasks,
        VoiceCommandType.filterTasks,
        VoiceCommandType.clearFilter,
        VoiceCommandType.themeTasks,
        VoiceCommandType.openTask,
      }.contains(command.type);

  bool get isDisposed => _disposed;

  /// 声の答えを待っているか（聞き取りが止まっていれば「もう一度話す」を出す）
  bool get waitingForSpeech => _answer != null;

  /// いまの聞き取りで言葉が届いているか（聞き取り表示の「声を受け取り中」。前の文が残っているだけなら false）
  bool get hearingWords => listening && _gotWords;

  // ---- シートからの操作 ----

  /// 聞き取りを始める（シートを開いたとき1回）。
  /// [initialText] があれば、それを聞き取ったコマンドとして解釈から続ける（常時聞き取りの文）
  void start({String? initialText}) {
    if (_started) return;
    _started = true;
    final text = initialText?.trim() ?? '';
    if (text.isEmpty) {
      _guard(() => _commandTurn());
      return;
    }
    _guard(() async {
      _resetCommand();
      heard = text;
      _notify();
      await _handleCommandText(text);
    });
  }

  /// 確定した文をシートなしで実行する（音声操作モードの常時聞き取り）。
  /// 実行し終えた（失敗はスナックバーで出した）なら true。
  /// 聞き返し・確認・選択が要るなら、データも画面も変えずに false を返す（呼ぶ側がシートを開く）
  Future<bool> runDirect(String text) async {
    if (_started) return true;
    _started = true;
    _direct = true;
    heard = text.trim();
    try {
      await _handleCommandText(heard);
    } on _NeedsSheet {
      return false;
    } on _Failure catch (e) {
      ui.showMessage(e.message);
    } on _Stop {
      // 破棄された
    } on _Cancelled {
      // シートなしで止める操作は無い
    } catch (e) {
      ui.showMessage('うまく実行できませんでした: $e');
    }
    return true;
  }

  /// タップでの答え（候補の番号・はい／いいえ・ラピへ送る）
  void answer(String text) {
    if (_answer == null) return;
    _session++;
    if (listening) dictation.cancel();
    listening = false;
    heard = text;
    _complete(text);
  }

  /// 「完了」：聞き取りを終える（確定した結果で進む）
  void finishListening() {
    if (listening) dictation.stop();
  }

  /// 「もう一度話す」：聞き取りをやり直す
  void listenAgain() {
    if (_answer == null) {
      // 結果・失敗の表示から次のコマンドへ
      _guard(() => _commandTurn());
      return;
    }
    phase = _listenPhase;
    prompt = _listenPrompt;
    _startListening();
  }

  /// 「キャンセル」「閉じる」のタップ：聞き取りを捨ててシートを閉じる
  void dismiss() {
    _closeSheet();
  }

  @override
  void dispose() {
    _disposed = true;
    _session++;
    _closeTimer?.cancel();
    if (listening) dictation.cancel();
    listening = false;
    final pending = _answer;
    _answer = null;
    pending?.complete(null);
    super.dispose();
  }

  // ---- 聞き取り ----

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _complete(String? text) {
    final c = _answer;
    _answer = null;
    c?.complete(text);
  }

  /// 聞き取って文を返す。シートが閉じられたら _Stop
  Future<String> _hear({
    required VoiceFlowPhase phase,
    required String prompt,
    List<String> choices = const [],
    bool keepView = false,
  }) async {
    if (_direct) throw _NeedsSheet();
    if (_disposed || _sheetClosed) throw _Stop();
    if (!keepView) {
      this.phase = phase;
      this.prompt = prompt;
      this.choices = choices;
    }
    _listenPhase = this.phase;
    _listenPrompt = this.prompt;
    _keepView = keepView;
    final c = Completer<String?>();
    _answer = c;
    _startListening();
    final text = await c.future;
    if (text == null) throw _Stop();
    _ensureOpen();
    return text.trim();
  }

  /// 答えを聞く。「キャンセル」「やめる」なら流れを止める
  Future<String> _ask({
    required VoiceFlowPhase phase,
    required String prompt,
    List<String> choices = const [],
  }) async {
    final text = await _hear(phase: phase, prompt: prompt, choices: choices);
    if (VoiceCommandParser.isCancel(text)) throw _Cancelled();
    return text;
  }

  Future<void> _startListening() async {
    final session = ++_session;
    listening = true;
    _gotWords = false;
    // さっき認識した文（コマンド・前の答え）は、次に話し始めるまで残しておく（話し始めたら置き換わる）
    _notify();
    DictationStartFailure? failure;
    try {
      failure = await dictation.start(
        onWords: (words) {
          if (session != _session || _disposed) return;
          _gotWords = true;
          heard = words;
          _notify();
        },
        onEnd: (end) => _onEnd(session, end),
      );
    } catch (_) {
      failure = DictationStartFailure.unavailable;
    }
    if (session != _session || _disposed || failure == null) return;
    listening = false;
    _session++;
    final message = failure == DictationStartFailure.permissionDenied
        ? 'マイクの権限がありません。設定アプリでマイクと音声認識を許可してください'
        : 'この端末では音声認識を使えません';
    // 聞き取れないので流れは止める（答え待ちを捨てる）
    final pending = _answer;
    _answer = null;
    _setFailed(message, followUp: false);
    pending?.complete(null);
  }

  void _onEnd(int session, DictationEnd end) {
    if (session != _session || _disposed) return;
    listening = false;
    final text = _gotWords ? heard.trim() : '';
    if (end == DictationEnd.completed && text.isNotEmpty) {
      _complete(text);
      return;
    }
    // 聞き取れなかった：勝手に聞き直さず、「もう一度話す」を待つ
    if (!_keepView) {
      phase = VoiceFlowPhase.heardNothing;
      prompt = end == DictationEnd.failed ? '音声をうまく認識できませんでした' : '声を聞き取れませんでした';
    }
    _notify();
  }

  // ---- 流れ ----

  /// シートが閉じられた・破棄された後なら流れを止める（_Stop）。
  /// 非同期の待ちの後と、データを変える処理を始める直前に呼ぶ
  void _ensureOpen() {
    if (_disposed || _sheetClosed) throw _Stop();
  }

  Future<void> _guard(Future<void> Function() body) async {
    try {
      await body();
    } on _Stop {
      // シートが閉じられた
    } on _Cancelled {
      _setCancelled();
    } on _Failure catch (e) {
      _setFailed(e.message);
    } catch (e) {
      _setFailed('うまく実行できませんでした: $e');
    }
  }

  void _resetCommand() {
    interpretation = null;
    note = null;
    unknownText = null;
    helpLines = const [];
    _defaulted = false;
    _learning.reset();
    _correctionNotice = null;
  }

  Future<void> _commandTurn() async {
    _resetCommand();
    final text = await _hear(
      phase: VoiceFlowPhase.listening,
      prompt: 'コマンドを話してください（「ヘルプ」で使えるコマンドを表示）',
    );
    await _handleCommandText(text);
  }

  /// 失敗・ヘルプ・理解できなかった表示のまま、次のコマンドを聞く
  Future<void> _followUp() async {
    final text = await _hear(phase: phase, prompt: prompt, keepView: true);
    // 結果・ヘルプを見たあとの「閉じる」はこのシートだけを閉じる（下のシートやダイアログは閉じない）
    if (parser.parse(text, screen: screen).type == VoiceCommandType.close) {
      _closeSheet();
      return;
    }
    if (phase == VoiceFlowPhase.notUnderstood) {
      // コマンドとして読めればそちらを優先し、読めなければ「ラピに送るか」への答えとして読む
      final command = parser.parse(text, screen: screen);
      if (command.isUnknown) {
        final yes = VoiceCommandParser.parseYesNo(text);
        // 否定を先に見る（「送らないで」を「送」に引っ張られて送らない）
        if (yes == false) {
          _closeSheet();
          return;
        }
        // 送るのは明確な肯定か、送る指示として完結した文だけ（「送信は不要です」は送らない）
        if (yes == true || VoiceCommandParser.isSendToRapi(text)) {
          await _sendToRapi(unknownText ?? '');
          return;
        }
        // どちらとも取れない：元の文を残したまま聞き直す（3回でやめる）
        _rapiAsks++;
        if (_rapiAsks >= 3) throw _Cancelled();
        prompt = 'ラピに送るなら「はい」、送らないなら「いいえ」と答えてください';
        _notify();
        await _followUp();
        return;
      }
    }
    _resetCommand();
    await _handleCommandText(text);
  }

  Future<void> _handleCommandText(String text) async {
    final command = parser.parse(text, screen: screen);
    if (!command.isUnknown) interpretation = command.summary;
    await _execute(command);
  }

  Future<void> _execute(VoiceCommand cmd) async {
    switch (cmd.type) {
      case VoiceCommandType.cancel:
        throw _Cancelled();
      case VoiceCommandType.unknown:
        phase = VoiceFlowPhase.notUnderstood;
        unknownText = cmd.rawText;
        _rapiAsks = 0;
        prompt = cmd.hint ?? 'コマンドとして理解できませんでした';
        choices = const [];
        _notify();
        await _followUp();
      case VoiceCommandType.help:
        phase = VoiceFlowPhase.help;
        prompt = '${voiceScreenLabel(path)}で使えるコマンド';
        helpLines = voiceHelpFor(screen);
        choices = const [];
        _notify();
        await _followUp();
      case VoiceCommandType.navigate:
        final to = cmd.path!;
        final label = voiceScreenLabel(to);
        if (to == path) throw _Failure('いま$labelを表示しています');
        await _outside('$labelを開きます', () {
          isVoiceTabPath(to) ? ui.go(to) : ui.push(to);
          return '$labelを開きました';
        });
      case VoiceCommandType.back:
        await _outside('前の画面に戻ります', () => ui.back() ? '前の画面に戻りました' : 'これ以上戻れません');
      case VoiceCommandType.close:
        await _outside('閉じます', () => ui.closePopup() ? '閉じました' : null);
      case VoiceCommandType.scrollDown:
      case VoiceCommandType.scrollUp:
        final down = cmd.type == VoiceCommandType.scrollDown;
        await _outside(down ? '下にスクロールします' : '上にスクロールします', () {
          return ui.scroll(path, down: down) ? null : 'この画面ではスクロールできません';
        });
      case VoiceCommandType.refresh:
        await _outside('更新します', () => ui.refresh(path) ? '再読み込みしています' : 'この画面では更新できません');
      case VoiceCommandType.approveRequest:
        await _approve(cmd);
      case VoiceCommandType.rejectRequest:
        await _reject(cmd);
      case VoiceCommandType.executeTask:
        await _executeTask(cmd);
      case VoiceCommandType.stopExecution:
        await _stop(cmd);
      case VoiceCommandType.resumeExecution:
        await _resume(cmd);
      case VoiceCommandType.createTask:
        await _createTask(cmd);
      case VoiceCommandType.searchTasks:
        final query = cmd.query!;
        await _outside('「$query」で検索します', () {
          container.read(voiceTaskSearchRequestProvider.notifier).state = query;
          if (path != '/tasks') ui.go('/tasks');
          return 'タスクを「$query」で検索しました';
        });
      case VoiceCommandType.filterTasks:
        await _filter(cmd);
      case VoiceCommandType.clearFilter:
        await _outside('絞り込みを解除します', () {
          container.read(taskFilterProvider.notifier).state = const TaskFilter();
          if (path != '/tasks') ui.go('/tasks');
          return 'タスクの絞り込みを解除しました';
        });
      case VoiceCommandType.themeTasks:
        final theme = await _resolveTheme(cmd.themeName!);
        await _outside('テーマ「${theme.name}」のタスクを表示します', () {
          container.read(taskFilterProvider.notifier).state = TaskFilter(themeId: theme.id);
          if (path != '/tasks') ui.go('/tasks');
          return 'テーマ「${theme.name}」のタスクを表示しました';
        });
      case VoiceCommandType.openTask:
        final task = await _pick(await _visibleTasks(), cmd.target, (t) => t.title,
            noun: 'タスク', kind: VoiceTargetKind.task, idOf: (t) => t.id);
        if (_defaulted || _corrected) await _confirm('「${task.title}」を開きますか？');
        await _outside('「${task.title}」を開きます', () {
          ui.push('/tasks/${task.id}');
          return '「${task.title}」を開きました';
        });
      case VoiceCommandType.editTask:
        await _editTask(cmd);
      case VoiceCommandType.deleteTask:
        await _deleteTask();
      case VoiceCommandType.createIdea:
        await _createIdea(cmd);
      case VoiceCommandType.createConcern:
        await _createConcern(cmd);
      case VoiceCommandType.setHypothesisStatus:
        await _setHypothesisStatus(cmd);
      case VoiceCommandType.deleteHypothesis:
        final list = await _load(() => container.read(hypothesisListProvider.future), '仮説');
        final h = await _pick(list, cmd.target, _hypothesisLabel,
            noun: '仮説', kind: VoiceTargetKind.hypothesis, idOf: (h) => h.id);
        await _confirm('「${_hypothesisLabel(h)}」を削除しますか？\n元に戻せません。');
        await _perform(() async {
          await container.read(backlogServiceProvider).deleteHypothesis(h.id);
          await _learning.deleted(VoiceTargetKind.hypothesis, h.id);
          container.invalidate(hypothesisListProvider);
          return '仮説を削除しました';
        }, failure: '仮説の削除に失敗しました');
      case VoiceCommandType.deleteIdea:
        final list = await _load(() => container.read(ideaListProvider.future), 'アイデア');
        final idea = await _pick(list, cmd.target, (i) => i.title,
            noun: 'アイデア', kind: VoiceTargetKind.idea, idOf: (i) => i.id);
        await _confirm('「${idea.title}」を削除しますか？\n元に戻せません。');
        await _perform(() async {
          await container.read(backlogServiceProvider).deleteIdea(idea.id);
          await _learning.deleted(VoiceTargetKind.idea, idea.id);
          container.invalidate(ideaListProvider);
          return 'アイデア「${idea.title}」を削除しました';
        }, failure: 'アイデアの削除に失敗しました');
      case VoiceCommandType.deleteConcern:
        final list = await _load(() => container.read(concernListProvider.future), '懸念');
        final concern = await _pick(list, cmd.target, (c) => c.title,
            noun: '懸念', kind: VoiceTargetKind.concern, idOf: (c) => c.id);
        await _confirm('「${concern.title}」を削除しますか？\n元に戻せません。');
        await _perform(() async {
          await container.read(backlogServiceProvider).deleteConcern(concern.id);
          await _learning.deleted(VoiceTargetKind.concern, concern.id);
          container.invalidate(concernListProvider);
          return '懸念「${concern.title}」を削除しました';
        }, failure: '懸念の削除に失敗しました');
    }
  }

  // ---- 承認 ----

  static const Map<String, String> _approvalStatusLabels = {
    'approved': '承認済み',
    'rejected': '却下済み',
    'expired': '期限切れ',
  };

  /// 対象の承認リクエストを決める。
  /// 番号・名前は承認画面に出ている並び（処理済みも含む全件）で解決し、
  /// 当たった行が保留中でなければ操作しない。指定なしのときは先頭の保留中のもの
  Future<ApprovalRequest> _pickApproval(VoiceTarget? target) async {
    final all = await _load(() => container.read(approvalListProvider.future), '承認リクエスト');
    if (target == null) {
      return _pick(all.where((a) => a.isPending).toList(), null, (a) => a.title,
          noun: '保留中の承認リクエスト', kind: VoiceTargetKind.approval, idOf: (a) => a.id);
    }
    final picked =
        await _pick(all, target, (a) => a.title, noun: '承認リクエスト', kind: VoiceTargetKind.approval, idOf: (a) => a.id);
    if (!picked.isPending) {
      final state = _approvalStatusLabels[picked.status] ?? picked.status;
      throw _Failure('その項目は既に処理済みです（「${picked.title}」は$state）');
    }
    return picked;
  }

  Future<void> _approve(VoiceCommand cmd) async {
    final target = await _pickApproval(cmd.target);
    await _confirm('「${target.title}」を承認しますか？');
    await _perform(() async {
      await container.read(approvalServiceProvider).approve(target.id);
      container.invalidate(approvalListProvider);
      return '「${target.title}」を承認しました';
    }, failure: '承認に失敗しました');
  }

  Future<void> _reject(VoiceCommand cmd) async {
    final target = await _pickApproval(cmd.target);
    var reason = cmd.reason;
    if (reason == null) {
      final answer = await _ask(phase: VoiceFlowPhase.asking, prompt: '却下の理由を話してください（「なし」で理由なし）');
      reason = VoiceCommandParser.isNone(answer) ? null : answer;
    }
    await _confirm('「${target.title}」を却下しますか？${reason != null ? '\n理由：$reason' : ''}');
    await _perform(() async {
      await container.read(approvalServiceProvider).reject(target.id, reason: reason);
      container.invalidate(approvalListProvider);
      return '「${target.title}」を却下しました';
    }, failure: '却下に失敗しました');
  }

  // ---- 実行 ----

  void _invalidateExecutions() {
    container.invalidate(executingTasksProvider);
    container.invalidate(resumableExecutionsProvider);
    container.invalidate(taskExecutionLogsProvider);
    container.invalidate(taskListProvider);
  }

  Future<Map<String, String>> _taskTitles() async {
    try {
      await container.read(taskListProvider(const TaskFilter()).future);
    } catch (_) {
      // タイトルが引けなければ「タスク #id」で出す
    }
    _ensureOpen();
    return container.read(taskTitleLookupProvider);
  }

  Future<void> _executeTask(VoiceCommand cmd) async {
    final Task task;
    final detailId = voiceTaskIdOf(path);
    if (screen == VoiceScreen.taskDetail && detailId != null) {
      task = await _load(() => container.read(taskDetailProvider(detailId).future), 'タスク');
      note = '「${task.title}」を対象にします';
    } else if (screen == VoiceScreen.tasks) {
      task = await _pick(await _visibleTasks(), cmd.target, (t) => t.title,
          noun: 'タスク', kind: VoiceTargetKind.task, idOf: (t) => t.id);
    } else {
      // 実行画面のタップの導線と同じく、未着手のタスクのうちエージェントで実行できるもの
      final todo = await _load(() => container.read(taskServiceProvider).getTasks(status: 'todo'), 'タスク');
      final executable = todo.where((t) => t.canExecuteWithAgent).toList();
      task = await _pick(executable, cmd.target, (t) => t.title,
          noun: '実行できるタスク', kind: VoiceTargetKind.task, idOf: (t) => t.id);
    }
    if (!task.canExecuteWithAgent) throw _Failure('「${task.title}」はエージェントで実行できません');
    await _confirm('「${task.title}」をAIエージェントで実行しますか？');
    await _perform(() async {
      final result = await container.read(agentServiceProvider).executeTask(task.id);
      _invalidateExecutions();
      container.invalidate(taskDetailProvider(task.id));
      return result.isAwaitingQuestion
          ? (result.message ?? '「${task.title}」の仕様確認の質問を作成しました')
          : '「${task.title}」の実行を開始しました';
    }, failure: '実行に失敗しました');
  }

  Future<void> _stop(VoiceCommand cmd) async {
    final executing = await _load(() => container.read(executingTasksProvider.future), '実行中のタスク');
    final titles = await _taskTitles();
    String label(ExecutingTask t) => taskTitleOrFallback(titles, t.taskId);
    final ExecutingTask target;
    final detailId = voiceTaskIdOf(path);
    if (screen == VoiceScreen.taskDetail && detailId != null) {
      final match = executing.where((t) => t.taskId == detailId).toList();
      if (match.isEmpty) throw _Failure('このタスクは実行中ではありません');
      target = match.first;
      note = '「${label(target)}」を対象にします';
    } else {
      // 実行ごとに変わる executionId ではなく taskId で覚える（設計 §4.2）
      target = await _pick(executing, cmd.target, label,
          noun: '実行中のタスク', kind: VoiceTargetKind.executingTask, idOf: (t) => t.taskId);
    }
    await _confirm('「${label(target)}」の実行を停止しますか？');
    await _perform(() async {
      await container.read(agentServiceProvider).stopTaskExecution(target.taskId);
      _invalidateExecutions();
      container.invalidate(taskDetailProvider(target.taskId));
      return '「${label(target)}」の実行を停止しました';
    }, failure: '停止に失敗しました');
  }

  Future<void> _resume(VoiceCommand cmd) async {
    final all = await _load(() => container.read(resumableExecutionsProvider.future), '再開可能な実行');
    final resumable = all.where((e) => e.canResume).toList();
    final titles = await _taskTitles();
    String label(ResumableExecution e) => e.taskTitle ?? taskTitleOrFallback(titles, e.taskId);
    // タスクの外れた実行（taskId が null）は覚えない（id は実行ごとに変わるため）
    final target = await _pick(resumable, cmd.target, label,
        noun: '再開できる実行', kind: VoiceTargetKind.resumable, idOf: (e) => e.taskId);
    await _confirm('「${label(target)}」の実行を再開しますか？');
    await _perform(() async {
      await container.read(agentServiceProvider).resumeExecution(target.id);
      _invalidateExecutions();
      final taskId = target.taskId;
      if (taskId != null) container.invalidate(taskDetailProvider(taskId));
      return '「${label(target)}」の実行を再開しました';
    }, failure: '再開に失敗しました');
  }

  // ---- タスク ----

  Future<List<Task>> _visibleTasks() async {
    final visible = VoiceTaskListHook.visibleTasks?.call();
    if (visible != null) return visible;
    final filter = container.read(taskFilterProvider);
    return _load(() => container.read(taskListProvider(filter).future), 'タスク');
  }

  Future<void> _createTask(VoiceCommand cmd) async {
    final title = cmd.title ?? await _askRequired('タスクのタイトルを話してください', 'タイトル');
    interpretation = 'タスク作成（タイトル「$title」）';

    List<TaskTheme> themes = const [];
    try {
      themes = await container.read(themeListProvider.future);
    } catch (_) {
      // テーマ一覧が取れなければテーマは聞かない（フォームと同じ方針）
    }
    _ensureOpen();
    TaskTheme? theme;
    if (themes.isNotEmpty) theme = await _askTheme(themes);

    var priority = cmd.priority;
    priority ??= await _askPriority();

    interpretation = [
      'タスク作成（タイトル「$title」',
      if (theme != null) '・テーマ「${theme.name}」',
      if (priority != null) '・優先度 ${VoiceCommandParser.priorityLabels[priority]}',
      '）',
    ].join();
    await _perform(() async {
      // タスク作成フォームと同じボディ（優先度の指定なしはフォームの既定値「中」）
      final body = buildTaskFormBody(title: title, priority: priority ?? 'medium', themeId: theme?.id);
      await container.read(taskServiceProvider).createTask(body);
      container.invalidate(taskListProvider);
      return 'タスク「$title」を作成しました';
    }, failure: 'タスクの作成に失敗しました');
  }

  Future<TaskTheme?> _askTheme(List<TaskTheme> themes) async {
    var question = 'テーマを話してください（番号でも可。「なし」で指定しません）';
    for (var attempt = 0; attempt < 3; attempt++) {
      final answer = await _ask(
        phase: VoiceFlowPhase.asking,
        prompt: question,
        choices: [for (final t in themes) t.name],
      );
      if (VoiceCommandParser.isNone(answer)) return null;
      final n = VoiceCommandParser.parseChoice(answer);
      final index = n == -1 ? themes.length : n;
      if (index != null && index >= 1 && index <= themes.length) return themes[index - 1];
      final matches = VoiceTargetResolver.matching(themes, answer, (t) => t.name);
      if (matches.length == 1) return matches.first;
      if (matches.length > 1) {
        return _choose<TaskTheme>(matches, (t) => t.name, '「$answer」に当たるテーマが${matches.length}件あります。番号で選んでください');
      }
      final learned = await _learnedTarget(themes, answer, (t) => t.name, kind: VoiceTargetKind.theme, idOf: (t) => t.id);
      if (learned != null) {
        // NOTE: タスク作成には最後の確認が無いので、補正でテーマを決めたときだけ確かめる（設計 §3.3）
        await _confirm('テーマ「${learned.name}」で作成しますか？');
        return learned;
      }
      final near = VoiceTargetResolver.nearest(themes, answer, (t) => t.name);
      if (near.isNotEmpty) {
        final picked = await _choose<TaskTheme>(near, (t) => t.name,
            '「$answer」というテーマは見つかりませんでした。近いものを番号で選んでください（違うなら「キャンセル」）');
        _learning.candidate(VoiceTargetKind.theme, answer, picked.id, picked.name);
        return picked;
      }
      question = '「$answer」というテーマは見つかりませんでした。テーマ名か番号を話すか、「なし」と言ってください';
    }
    throw _Failure('テーマを決められませんでした');
  }

  Future<String?> _askPriority() async {
    const values = ['urgent', 'high', 'medium', 'low'];
    var question = '優先度を話してください（緊急・高・中・低。「なし」で指定しません）';
    for (var attempt = 0; attempt < 3; attempt++) {
      final answer = await _ask(
        phase: VoiceFlowPhase.asking,
        prompt: question,
        choices: [for (final v in values) VoiceCommandParser.priorityLabels[v]!],
      );
      if (VoiceCommandParser.isNone(answer)) return null;
      final p = VoiceCommandParser.parsePriority(answer);
      if (p != null) return p;
      final n = VoiceCommandParser.parseChoice(answer);
      if (n != null && n >= 1 && n <= values.length) return values[n - 1];
      question = '「緊急」「高」「中」「低」のどれかで答えてください（「なし」で指定しません）';
    }
    throw _Failure('優先度を決められませんでした');
  }

  Future<void> _filter(VoiceCommand cmd) async {
    final current = container.read(taskFilterProvider);
    final TaskFilter next;
    final String label;
    final status = cmd.status;
    final priority = cmd.priority;
    if (status != null) {
      next = current.copyWith(status: status);
      label = VoiceCommandParser.statusLabels[status] ?? status;
    } else if (priority != null) {
      next = current.copyWith(priority: priority);
      label = '優先度 ${VoiceCommandParser.priorityLabels[priority] ?? priority}';
    } else {
      final theme = await _resolveTheme(cmd.themeName!);
      next = current.copyWith(themeId: theme.id);
      label = 'テーマ「${theme.name}」';
    }
    await _outside('$labelで絞り込みます', () {
      container.read(taskFilterProvider.notifier).state = next;
      if (path != '/tasks') ui.go('/tasks');
      return 'タスクを$labelで絞り込みました';
    });
  }

  Future<TaskTheme> _resolveTheme(String name) async {
    final themes = await _load(() => container.read(themeListProvider.future), 'テーマ');
    final matches = VoiceTargetResolver.matching(themes, name, (t) => t.name);
    if (matches.isEmpty) {
      // 絞り込みは表示を変えるだけなので、補正で決まっても確認しない（結果のスナックバーにその旨を出す：§3.3）
      return _correctOrNear(themes, name, (t) => t.name,
          noun: 'テーマ',
          kind: VoiceTargetKind.theme,
          idOf: (t) => t.id,
          notFound: '「$name」というテーマは見つかりませんでした');
    }
    if (matches.length == 1) return matches.first;
    // 完全一致があればそれを使う
    final exact =
        matches.where((t) => VoiceTargetResolver.norm(t.name) == VoiceTargetResolver.norm(name)).toList();
    if (exact.length == 1) return exact.first;
    return _choose(matches, (t) => t.name, '「$name」に当たるテーマが${matches.length}件あります。番号で選んでください');
  }

  Future<void> _editTask(VoiceCommand cmd) async {
    final Task task;
    final detailId = voiceTaskIdOf(path);
    if (screen == VoiceScreen.taskDetail && detailId != null) {
      task = await _load(() => container.read(taskDetailProvider(detailId).future), 'タスク');
    } else {
      task = await _pick(await _visibleTasks(), cmd.target, (t) => t.title,
          noun: 'タスク', kind: VoiceTargetKind.task, idOf: (t) => t.id);
      if (_defaulted || _corrected) await _confirm('「${task.title}」を編集しますか？');
    }
    await _outside('「${task.title}」の編集画面を開きます', () {
      ui.push('/tasks/${task.id}/edit', extra: task);
      return '「${task.title}」の編集画面を開きました';
    });
  }

  Future<void> _deleteTask() async {
    final id = voiceTaskIdOf(path);
    if (id == null) throw _Failure('タスク詳細で話してください');
    final task = await _load(() => container.read(taskDetailProvider(id).future), 'タスク');
    note = '「${task.title}」を対象にします';
    await _confirm('「${task.title}」を削除しますか？\nこの操作は取り消せません。');
    _ensureOpen();
    phase = VoiceFlowPhase.running;
    prompt = '削除しています…';
    choices = const [];
    _notify();
    try {
      await container.read(taskServiceProvider).deleteTask(id);
    } catch (e) {
      throw _Failure('タスクの削除に失敗しました: $e');
    }
    await _learning.deleted(VoiceTargetKind.task, id);
    container.invalidate(taskListProvider);
    // 削除したタスクの詳細には居られないので、閉じて一覧へ戻る
    final message = 'タスク「${task.title}」を削除しました';
    _closeSheet();
    if (!ui.back()) ui.go('/tasks');
    ui.showMessage(message);
  }

  // ---- バックログ ----

  Future<void> _createIdea(VoiceCommand cmd) async {
    final title = cmd.title ?? await _askRequired('アイデアのタイトルを話してください', 'タイトル');
    interpretation = 'アイデア作成（タイトル「$title」）';
    final content = await _ask(phase: VoiceFlowPhase.asking, prompt: '内容を話してください（「なし」で省略）');
    final body = VoiceCommandParser.isNone(content) ? null : content;
    await _perform(() async {
      await container
          .read(backlogServiceProvider)
          .createIdea(buildIdeaCreateBody(title: title, content: body, priority: 'medium'));
      container.invalidate(ideaListProvider);
      return 'アイデア「$title」を作成しました';
    }, failure: 'アイデアの作成に失敗しました');
  }

  Future<void> _createConcern(VoiceCommand cmd) async {
    final title = cmd.title ?? await _askRequired('懸念のタイトルを話してください', 'タイトル');
    interpretation = '懸念の登録（タイトル「$title」）';
    final detail = await _askRequired('詳細を話してください（省略できません）', '詳細');
    await _perform(() async {
      // 種別・重要度は追加フォームの既定値（バグ・中）
      final stored = await container.read(backlogServiceProvider).createConcern(
            buildConcernCreateBody(title: title, detail: detail, type: 'bug', severity: 'medium'),
          );
      container.invalidate(concernListProvider);
      return stored ? '懸念「$title」を登録しました' : '同じような懸念が既にあるため、新しくは登録しませんでした';
    }, failure: '懸念の登録に失敗しました');
  }

  static String _hypothesisLabel(Hypothesis h) => h.statement.isNotEmpty ? h.statement : '（命題なし）';

  Future<void> _setHypothesisStatus(VoiceCommand cmd) async {
    final status = cmd.status!;
    final statusLabel = VoiceCommandParser.hypothesisStatusLabels[status] ?? status;
    final list = await _load(() => container.read(hypothesisListProvider.future), '仮説');
    final h = await _pick(list, cmd.target, _hypothesisLabel,
        noun: '仮説', kind: VoiceTargetKind.hypothesis, idOf: (h) => h.id);
    if (h.status == status) throw _Failure('「${_hypothesisLabel(h)}」はすでに「$statusLabel」です');
    // NOTE: 補正で決めた対象は、状態の変更が確認なしで走らないよう必ず確かめる（設計 §3.3）
    if (_defaulted || _corrected) await _confirm('「${_hypothesisLabel(h)}」を「$statusLabel」にしますか？');
    await _perform(() async {
      await container.read(backlogServiceProvider).updateHypothesisStatus(h.id, status);
      container.invalidate(hypothesisListProvider);
      return '仮説の状態を「$statusLabel」にしました';
    }, failure: '状態の変更に失敗しました');
  }

  // ---- ラピへ送る ----

  Future<void> _sendToRapi(String text) async {
    if (text.trim().isEmpty) throw _Failure('送る文がありません');
    await _outside('ラピに送ります', () {
      final chat = container.read(rapiChatProvider.notifier);
      if (container.read(rapiChatProvider).sending) return 'ラピが応答中のため送れませんでした。チャット画面で送ってください';
      chat.setInput(text);
      chat.send();
      if (path != '/rapi') ui.go('/rapi');
      return 'ラピに送りました';
    });
  }

  // ---- 共通の部品 ----

  /// 対象を決める。指定なし → 先頭（その旨を note に出す）、番号 → その行、名前 → 一致するもの。
  /// 名前が1件も当たらなければ、学習した補正 → 近い候補の順に試す（[kind]・[idOf] はそのため）
  Future<T> _pick<T>(
    List<T> items,
    VoiceTarget? target,
    String Function(T) label, {
    required String noun,
    required VoiceTargetKind kind,
    required String? Function(T) idOf,
  }) async {
    if (items.isEmpty) throw _Failure('$nounはありません');
    if (target == null) {
      _defaulted = true;
      note = '対象の指定がないので、先頭の「${label(items.first)}」を対象にします';
      _notify();
      return items.first;
    }
    final index = target.index;
    if (index != null) {
      final i = index == -1 ? items.length : index;
      if (i < 1 || i > items.length) throw _Failure('$i番目の$nounはありません（${items.length}件）');
      note = '$i番目の「${label(items[i - 1])}」を対象にします';
      _notify();
      return items[i - 1];
    }
    final matches = VoiceTargetResolver.matching(items, target.name!, label);
    if (matches.isEmpty) {
      return _correctOrNear(items, target.name!, label,
          noun: noun, kind: kind, idOf: idOf, notFound: '「${target.name}」に当たる$nounが見つかりません');
    }
    if (matches.length == 1) {
      note = '「${label(matches.first)}」を対象にします';
      _notify();
      return matches.first;
    }
    return _choose(matches, label, '「${target.name}」に当たる$nounが${matches.length}件あります。番号で選んでください');
  }

  /// 学習した補正で、いまの一覧にある対象を引く（学習がオフ・未学習・一覧に無いなら null）。
  /// 見つかったら補正で決めた印を付け、note とスナックバーにその旨を出す
  Future<T?> _learnedTarget<T>(
    List<T> items,
    String name,
    String Function(T) label, {
    required VoiceTargetKind kind,
    required String? Function(T) idOf,
  }) async {
    final learned = await _learning.lookup(kind, name);
    _ensureOpen();
    if (learned == null) return null;
    // 一覧に無いことは削除の証拠にならない（絞り込み・状態で隠れているだけかもしれない）ので消さずに見送る
    final hit = VoiceTargetResolver.byId(items, learned.targetId, idOf);
    if (hit == null) return null;
    _learning.applied(learned, label(hit));
    note = '「$name」は前に「${label(hit)}」を選んだので、それを対象にします';
    _correctionNotice = '（「$name」は前に選んだ「${label(hit)}」として扱いました）';
    _notify();
    return hit;
  }

  /// 名前が1件も当たらなかったとき：学習した補正があればそれ、無ければ近い候補を選ばせる（設計 §1.4・§3.2）。
  /// 近い候補での選択は「記録の候補」にするだけで、成功したときにだけ覚える
  Future<T> _correctOrNear<T>(
    List<T> items,
    String name,
    String Function(T) label, {
    required String noun,
    required VoiceTargetKind kind,
    required String? Function(T) idOf,
    required String notFound,
  }) async {
    final learned = await _learnedTarget(items, name, label, kind: kind, idOf: idOf);
    if (learned != null) return learned;
    final near = VoiceTargetResolver.nearest(items, name, label);
    if (near.isEmpty) throw _Failure(notFound);
    // シートなしの実行では _hear が _NeedsSheet を投げ、何も変えずにシートへ回る
    final picked = await _choose(near, label, '「$name」に当たる$nounは見つかりませんでした。近いものを番号で選んでください（違うなら「キャンセル」）');
    _learning.candidate(kind, name, idOf(picked), label(picked));
    return picked;
  }

  /// 候補を番号で選ばせる（名前の一部でも可）
  Future<T> _choose<T>(List<T> items, String Function(T) label, String question) async {
    var q = question;
    for (var attempt = 0; attempt < 3; attempt++) {
      final answer = await _ask(
        phase: VoiceFlowPhase.choosing,
        prompt: q,
        choices: [for (final item in items) label(item)],
      );
      final n = VoiceCommandParser.parseChoice(answer);
      final i = n == -1 ? items.length : n;
      if (i != null && i >= 1 && i <= items.length) {
        note = '$i番の「${label(items[i - 1])}」を対象にします';
        choices = const [];
        return items[i - 1];
      }
      final byName = VoiceTargetResolver.matching(items, answer, label);
      if (byName.length == 1) {
        note = '「${label(byName.first)}」を対象にします';
        choices = const [];
        return byName.first;
      }
      q = '番号で答えてください（1〜${items.length}）';
    }
    throw _Failure('候補を選べませんでした');
  }

  /// はい／いいえで決める。いいえ・キャンセルなら止める
  Future<void> _confirm(String question) async {
    var q = question;
    for (var attempt = 0; attempt < 3; attempt++) {
      final answer = await _ask(phase: VoiceFlowPhase.confirming, prompt: q);
      final yes = VoiceCommandParser.parseYesNo(answer);
      if (yes == true) return;
      if (yes == false) {
        // 補正で決めた対象を否定された：その対応を消す（操作をやめたかっただけでも、消すほうが安全側：§2.2）
        await _learning.rejected();
        throw _Cancelled();
      }
      q = '$question\n「はい」か「いいえ」で答えてください';
    }
    throw _Cancelled();
  }

  /// 省けない項目を聞く（「なし」なら聞き直す）
  Future<String> _askRequired(String question, String field) async {
    var q = question;
    for (var attempt = 0; attempt < 3; attempt++) {
      final answer = await _ask(phase: VoiceFlowPhase.asking, prompt: q);
      final text = answer.replaceFirst(RegExp(r'[。、]+$'), '').trim();
      if (text.isNotEmpty && !VoiceCommandParser.isNone(text)) return text;
      q = '$fieldは省けません。$question';
    }
    throw _Failure('$fieldを聞き取れませんでした');
  }

  Future<T> _load<T>(Future<T> Function() load, String what) async {
    _ensureOpen();
    phase = VoiceFlowPhase.running;
    prompt = '$whatを確認しています…';
    choices = const [];
    _notify();
    final T result;
    try {
      result = await load();
    } catch (e) {
      // 取得中に閉じられていたら失敗も出さずに止める
      _ensureOpen();
      throw _Failure('$whatを取得できませんでした: $e');
    }
    _ensureOpen();
    return result;
  }

  /// データを変える操作。結果をシートに出し、成功ならスナックバーにも残して少し後に閉じる
  Future<void> _perform(Future<String> Function() action, {required String failure}) async {
    // シートなしではデータを変えない（runsDirectly に入れていない操作の守り）
    if (_direct) throw _NeedsSheet();
    // 取得や確認の待ちの間に閉じられていたら、データは変えない
    _ensureOpen();
    phase = VoiceFlowPhase.running;
    prompt = '実行しています…';
    choices = const [];
    _notify();
    final String message;
    try {
      message = await action();
    } catch (e) {
      throw _Failure('$failure: $e');
    }
    // 成功したここでだけ学習を確定する（いいえ・キャンセル・失敗・途中で閉じたなら、ここまで来ない）
    await _learning.commit();
    if (_disposed) {
      // 実行中にシートを閉じられても、結果はスナックバーで残す
      ui.showMessage(message);
      return;
    }
    phase = VoiceFlowPhase.done;
    prompt = message;
    _notify();
    ui.showMessage(message);
    _closeTimer = Timer(closeDelay, _closeSheet);
  }

  /// シートの外の操作（移動・スクロールなど）。解釈を少し見せてからシートを閉じ、操作する。
  /// [act] の戻り値はスナックバーに出す文（null なら出さない）
  Future<void> _outside(String doing, String? Function() act) async {
    if (_direct) {
      // シートなし：すぐに操作して、結果だけスナックバーで出す
      _ensureOpen();
      final message = act();
      await _learning.commit();
      if (message != null) ui.showMessage(_withNotice(message));
      return;
    }
    phase = VoiceFlowPhase.done;
    prompt = doing;
    choices = const [];
    _notify();
    if (actionDelay > Duration.zero) await Future<void>.delayed(actionDelay);
    if (_sheetClosed || _disposed) {
      // 待っている間にシートを閉じられたら何もしない
      return;
    }
    _closeSheet();
    final message = act();
    await _learning.commit();
    if (message != null) ui.showMessage(_withNotice(message));
  }

  String _withNotice(String message) {
    final notice = _correctionNotice;
    return notice == null ? message : '$message$notice';
  }

  void _closeSheet() {
    if (_sheetClosed) return;
    _sheetClosed = true;
    _closeTimer?.cancel();
    _session++;
    if (listening) dictation.cancel();
    listening = false;
    final pending = _answer;
    _answer = null;
    pending?.complete(null);
    ui.closeSheet();
  }

  void _setFailed(String message, {bool followUp = true}) {
    if (_disposed) return;
    phase = VoiceFlowPhase.failed;
    prompt = message;
    choices = const [];
    _notify();
    // 失敗の理由を出したまま、次のコマンドを聞く（「閉じる」で閉じられる）
    if (followUp) _guard(_followUp);
  }

  void _setCancelled() {
    if (_disposed) return;
    phase = VoiceFlowPhase.cancelled;
    prompt = 'やめました';
    choices = const [];
    note = null;
    _notify();
    _closeTimer = Timer(closeDelay, _closeSheet);
  }

  // NOTE: 名前の一致（_matching）と正規化（_norm）は voice_target_resolver.dart へ移した（学習の引き当て・近さと共有するため）。
}
