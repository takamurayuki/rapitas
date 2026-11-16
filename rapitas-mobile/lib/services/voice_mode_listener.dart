import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'dictation_coordinator.dart';
import 'dictation_service.dart';
import 'voice_command_flow.dart';
import 'voice_command_parser.dart';
import 'voice_mode_types.dart';

export 'voice_mode_types.dart';

// 音声操作モードの常時聞き取り。
//
// モードがオンで、聞いてよい状態（アプリが前面・キーボードなし・入力欄にフォーカスなし）の間、
// 背面の聞き取りを張り続ける（1回の聞き取りは無音や上限時間で終わるので、終わったら張り直す）。
// 確定した文はコマンドとして解釈し、
// - コマンドでない文：何もしない（受付の表示は「話せます」のまま。少しの間 [VoiceModeListener.recentlyIgnored] を立てる）
// - そのまま実行できるコマンド：シートを開かずに実行し、結果はスナックバー
// - 対話が要るコマンド：コマンドシートをその文から開く。閉じたら聞き取りに戻る
// 前面の聞き取り（チャットのマイク・コマンドシート）が動いている間は止める（DictationCoordinator）。
//
// 画面側（パス・ルーター・シートを開く）は VoiceModeBinding で受け取る（アプリでは VoiceModeHost）。

/// 開始の失敗・すぐに終わる失敗がこの回数続いたら「使えない」表示にする
const int _unavailableAfter = 3;

class VoiceModeListener extends ChangeNotifier {
  VoiceModeListener({
    required this.coordinator,
    required this.parser,
    this.restartDelay = const Duration(milliseconds: 400),
    this.ignoredDuration = const Duration(seconds: 2),
    this.quickEnd = const Duration(seconds: 1),
  }) {
    coordinator.foregroundActive.addListener(_evaluate);
    coordinator.onBackgroundPreempted = _onPreempted;
  }

  final DictationCoordinator coordinator;
  final VoiceCommandParser parser;

  /// 聞き取りが終わってから張り直すまで（端末の認識が落ち着くのを待つ）
  final Duration restartDelay;

  /// 「コマンドではない」を表示しておく時間
  final Duration ignoredDuration;

  /// これより短く、何も聞こえずに終わった聞き取りが続いたら、張り直しの間を空ける（空回りを防ぐ）。
  /// Duration.zero なら空けない
  final Duration quickEnd;

  VoiceModeStatus _status = VoiceModeStatus.off;

  /// 聞き取り表示の状態
  VoiceModeStatus get status => _status;

  /// 最後に確定した文（聞き取り表示のツールチップに出す）
  String? get lastHeard => _lastHeard;
  String? _lastHeard;

  /// 直前の発話をコマンドではないとして聞き流した直後か（[ignoredDuration] の間だけ true）。
  /// 受付の状態ではないので [status] は変えない（読み上げ・ツールチップの説明に使う）
  bool get recentlyIgnored => _ignored;

  VoiceModeBinding? _binding;
  bool _enabled = false;
  bool _allowed = false;
  bool _busy = false;
  bool _active = false;

  /// いまの聞き取りの開始が成功したか（_active は開始の完了前にも立つので、「話せます」の根拠はこちら）
  bool _started = false;
  bool _gotWords = false;
  bool _ignored = false;
  bool _unavailable = false;
  bool _disposed = false;
  String _heard = '';
  int _session = 0;
  int _failures = 0;
  Timer? _restartTimer;
  Timer? _ignoredTimer;
  final Stopwatch _sessionClock = Stopwatch();

  /// いま開いているコマンドシートの流れ（処理中か回答待ちかを見分ける）
  VoiceCommandFlow? _flow;

  /// 背面の聞き取りが開いているか
  bool get isListening => _active;

  bool get _want =>
      !_disposed &&
      _enabled &&
      _allowed &&
      !_busy &&
      _binding != null &&
      !coordinator.foregroundActive.value;

  // ---- 画面からの操作 ----

  void attach(VoiceModeBinding binding) {
    _binding = binding;
    _evaluate();
  }

  void detach(VoiceModeBinding binding) {
    if (!identical(_binding, binding)) return;
    _binding = null;
    _ignoredTimer?.cancel();
    _ignored = false;
    _evaluate();
  }

  /// モードのオン・オフ（[enabled]）と、いま聞いてよいか（[allowed]：前面・キーボードなし・入力欄なし）
  void update({required bool enabled, required bool allowed}) {
    if (_enabled == enabled && _allowed == allowed) return;
    if (!enabled) {
      _failures = 0;
      _unavailable = false;
      _ignored = false;
    }
    _enabled = enabled;
    _allowed = allowed;
    _evaluate();
  }

  /// 聞き取り表示のタップ：コマンドシートを手で開く（聞き取りに失敗したときの予備）
  void openSheetManually() {
    final binding = _binding;
    if (binding == null || !_enabled || _busy) return;
    // チャットのマイクが動いている間は開かない（シートの聞き取りとぶつかる）
    if (coordinator.foregroundActive.value) return;
    _runBusy(() => binding.openSheet(binding.currentPath()));
  }

  /// コマンドシートが開いた：その流れの段階で「処理中」「回答待ち」「声を受け取り中」を出し分ける
  void trackFlow(VoiceCommandFlow flow) {
    _flow?.removeListener(_onFlowChanged);
    _flow = flow;
    flow.addListener(_onFlowChanged);
    _refreshSoon();
  }

  /// コマンドシートが閉じた。表示はシートの終わり（_runBusy の後始末）で戻すので、ここでは描き直さない
  /// （シートの破棄の途中で聞き取り表示を描き直させない）
  void untrackFlow(VoiceCommandFlow flow) {
    if (!identical(_flow, flow)) return;
    flow.removeListener(_onFlowChanged);
    _flow = null;
  }

  void _onFlowChanged() => _refreshSoon();

  /// build 中（シートの initState など）は聞き取り表示を描き直せないので、そのときは次のフレームで
  void _refreshSoon() {
    final phase = SchedulerBinding.instance.schedulerPhase;
    if (phase == SchedulerPhase.persistentCallbacks || phase == SchedulerPhase.midFrameMicrotasks) {
      SchedulerBinding.instance.addPostFrameCallback((_) => _refresh());
    } else {
      _refresh();
    }
  }

  // ---- 聞き取りの張り直し ----

  void _evaluate() {
    if (_disposed) return;
    if (_want) {
      if (!_active && _restartTimer == null) _scheduleStart(restartDelay);
    } else {
      _stopSession();
    }
    _refresh();
  }

  void _scheduleStart(Duration delay) {
    _restartTimer?.cancel();
    _restartTimer = Timer(delay, () {
      _restartTimer = null;
      if (_want && !_active) {
        _startSession();
      } else {
        _refresh();
      }
    });
  }

  void _stopSession() {
    _restartTimer?.cancel();
    _restartTimer = null;
    if (!_active) return;
    _session++;
    _active = false;
    _started = false;
    coordinator.background.cancel();
  }

  Future<void> _startSession() async {
    final session = ++_session;
    _active = true;
    _started = false;
    _gotWords = false;
    _heard = '';
    _sessionClock
      ..reset()
      ..start();
    _refresh();
    DictationStartFailure? failure;
    try {
      failure = await coordinator.background.start(
        onWords: (words) => _onWords(session, words),
        onEnd: (end) => _onEnd(session, end),
      );
    } catch (_) {
      failure = DictationStartFailure.unavailable;
    }
    if (session != _session || _disposed) return;
    if (failure == null) {
      // 開始できた：ここから「話せます」
      _started = true;
      _refresh();
      return;
    }
    _active = false;
    _session++;
    if (failure == DictationStartFailure.permissionDenied) {
      // 設定アプリで権限を外された：モードをオフにしてもらう（画面が update(enabled: false) を返す）
      _binding?.onPermissionLost();
      _refresh();
      return;
    }
    if (coordinator.foregroundActive.value) {
      // 前面の聞き取りが先に始まっていた（終わったら _evaluate で張り直す）
      _refresh();
      return;
    }
    _countFailure();
    _scheduleStart(_backoff());
    _refresh();
  }

  void _onWords(int session, String words) {
    if (session != _session || _disposed) return;
    _heard = words;
    if (words.trim().isNotEmpty) {
      _gotWords = true;
      _ignored = false;
    }
    _refresh();
  }

  void _onEnd(int session, DictationEnd end) {
    if (session != _session || _disposed) return;
    _active = false;
    _started = false;
    _session++;
    final text = _gotWords ? _heard.trim() : '';
    if (end == DictationEnd.completed && text.isNotEmpty) {
      _failures = 0;
      _unavailable = false;
      _handle(text);
      return;
    }
    // 何も聞こえずに終わった（無音・上限時間・認識の失敗）：張り直す。
    // すぐに終わる失敗が続くときだけ間を空ける
    final quick = quickEnd > Duration.zero && _sessionClock.elapsed < quickEnd;
    if (end == DictationEnd.failed || quick) {
      // 開始はできても直後に失敗で終わる状態が続くなら、開始の失敗と同じく「使えない」と見せる
      _countFailure();
    } else {
      _failures = 0;
      _unavailable = false;
    }
    if (_want) _scheduleStart(_failures == 0 ? restartDelay : _backoff());
    _refresh();
  }

  /// 前面の聞き取りに押しのけられた（onEnd は来ない）
  void _onPreempted() {
    if (_active) {
      _session++;
      _active = false;
      _started = false;
    }
    _evaluate();
  }

  /// 失敗を数える（開始の失敗・すぐに終わる失敗の両方）。3回続いたら「使えない」表示にする。
  /// 成功した聞き取り（文が届いた・普通の長さで終わった）で数えを戻す
  void _countFailure() {
    _failures++;
    if (_failures >= _unavailableAfter) _unavailable = true;
  }

  Duration _backoff() {
    final ms = restartDelay.inMilliseconds * (1 << (_failures.clamp(0, 5)));
    return Duration(milliseconds: ms.clamp(restartDelay.inMilliseconds, 10000));
  }

  // ---- 確定した文 ----

  Future<void> _handle(String text) async {
    _lastHeard = text;
    final binding = _binding;
    if (binding == null) {
      _evaluate();
      return;
    }
    final path = binding.currentPath();
    final command = parser.parse(text, screen: voiceScreenOf(path));
    // コマンドでない文（周りの会話など）と「キャンセル」だけの文は、シートを開かずに聞き流す
    if (command.isUnknown || command.type == VoiceCommandType.cancel) {
      _ignored = true;
      _ignoredTimer?.cancel();
      _ignoredTimer = Timer(ignoredDuration, () {
        _ignored = false;
        _refresh(force: true);
      });
      _evaluate();
      return;
    }
    await _runBusy(() async {
      if (VoiceCommandFlow.runsDirectly(command)) {
        final flow = VoiceCommandFlow(
          path: path,
          dictation: coordinator.foreground,
          container: binding.container,
          ui: binding.createUi(),
          parser: parser,
        );
        try {
          if (await flow.runDirect(text)) return;
        } finally {
          flow.dispose();
        }
      }
      // 対話が要る：その文の解釈からシートで続ける
      if (_disposed || !_enabled || !identical(_binding, binding)) return;
      await binding.openSheet(path, initialText: text);
    });
  }

  Future<void> _runBusy(Future<void> Function() body) async {
    _busy = true;
    _stopSession();
    _refresh();
    try {
      await body();
    } catch (_) {
      // 失敗の表示は流れ・シートが受け持つ。常時聞き取りは続ける
    } finally {
      _busy = false;
      _evaluate();
    }
  }

  // ---- 表示 ----

  bool _shownIgnored = false;

  /// [force]：状態が同じでも知らせる（聞き流しの説明が消えたときなど）
  void _refresh({bool force = false}) {
    if (_disposed) return;
    final next = _computeStatus();
    final ignored = _ignored && next != VoiceModeStatus.off;
    if (!force && next == _status && ignored == _shownIgnored) return;
    _status = next;
    _shownIgnored = ignored;
    notifyListeners();
  }

  VoiceModeStatus _computeStatus() {
    if (!_enabled) return VoiceModeStatus.off;
    if (_busy) return _busyStatus();
    if (_active && _gotWords) return VoiceModeStatus.hearing;
    if (_unavailable && _want) return VoiceModeStatus.unavailable;
    if (_active && _started) return VoiceModeStatus.ready;
    // 開始待ち・張り直しの合間は受付可能と断言しない（薄い「・・・」）
    if (_active || _want) return VoiceModeStatus.preparing;
    return VoiceModeStatus.paused;
  }

  /// コマンドの実行中・シート表示中：シートの段階で出し分ける（シートが無ければ処理中）
  VoiceModeStatus _busyStatus() {
    final flow = _flow;
    if (flow == null || flow.isDisposed) return VoiceModeStatus.processing;
    if (flow.hearingWords) return VoiceModeStatus.hearing;
    switch (flow.phase) {
      case VoiceFlowPhase.running:
      case VoiceFlowPhase.done:
      case VoiceFlowPhase.cancelled:
        return VoiceModeStatus.processing;
      case VoiceFlowPhase.listening:
      case VoiceFlowPhase.heardNothing:
      case VoiceFlowPhase.choosing:
      case VoiceFlowPhase.confirming:
      case VoiceFlowPhase.asking:
      case VoiceFlowPhase.failed:
      case VoiceFlowPhase.notUnderstood:
      case VoiceFlowPhase.help:
        return VoiceModeStatus.awaiting;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _restartTimer?.cancel();
    _ignoredTimer?.cancel();
    _flow?.removeListener(_onFlowChanged);
    _flow = null;
    if (_active) {
      _session++;
      _active = false;
      coordinator.background.cancel();
    }
    coordinator.foregroundActive.removeListener(_evaluate);
    if (coordinator.onBackgroundPreempted == _onPreempted) coordinator.onBackgroundPreempted = null;
    super.dispose();
  }
}
