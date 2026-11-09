import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dictation_coordinator.dart';
import 'dictation_service.dart';
import 'voice_command_flow.dart';
import 'voice_command_parser.dart';

// 音声操作モードの常時聞き取り。
//
// モードがオンで、聞いてよい状態（アプリが前面・キーボードなし・入力欄にフォーカスなし）の間、
// 背面の聞き取りを張り続ける（1回の聞き取りは無音や上限時間で終わるので、終わったら張り直す）。
// 確定した文はコマンドとして解釈し、
// - コマンドでない文：何もしない（聞き取り表示を少しの間「コマンドではない」にする）
// - そのまま実行できるコマンド：シートを開かずに実行し、結果はスナックバー
// - 対話が要るコマンド：コマンドシートをその文から開く。閉じたら聞き取りに戻る
// 前面の聞き取り（チャットのマイク・コマンドシート）が動いている間は止める（DictationCoordinator）。
//
// 画面側（パス・ルーター・シートを開く）は VoiceModeBinding で受け取る（アプリでは VoiceModeHost）。

/// 聞き取り表示に出す状態
enum VoiceModeStatus {
  /// モードがオフ（表示しない）
  off,

  /// モードはオンだが止めている（キーボード・入力欄・チャットのマイク・背面）
  paused,

  /// 聞き取り中（まだ何も聞こえていない）
  listening,

  /// 声が届いている
  hearing,

  /// コマンドを実行中・コマンドシートを表示中
  working,

  /// 聞こえたが、コマンドではなかった（少しの間だけ）
  ignored,

  /// 聞き取りを始められない・始めてもすぐ失敗で終わる（端末側の不調。少し待って張り直す）
  unavailable,
}

/// 常時聞き取りが画面に頼むこと
abstract class VoiceModeBinding {
  /// いま表示している画面のパス
  String currentPath();

  /// コマンドの実行に使うプロバイダの入れ物
  ProviderContainer get container;

  /// 画面の操作（移動・スナックバーなど）
  VoiceUi createUi();

  /// コマンドシートを開く（[initialText] があればその文の解釈から続ける）。閉じたら完了する
  Future<void> openSheet(String path, {String? initialText});

  /// 聞き取りの権限が無くなっていた（モードをオフにして理由を出す）
  void onPermissionLost();
}

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

  VoiceModeBinding? _binding;
  bool _enabled = false;
  bool _allowed = false;
  bool _busy = false;
  bool _active = false;
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
    coordinator.background.cancel();
  }

  Future<void> _startSession() async {
    final session = ++_session;
    _active = true;
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
    if (failure == null || session != _session || _disposed) return;
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
        _refresh();
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

  void _refresh() {
    if (_disposed) return;
    final VoiceModeStatus next;
    if (!_enabled) {
      next = VoiceModeStatus.off;
    } else if (_busy) {
      next = VoiceModeStatus.working;
    } else if (_active && _gotWords) {
      next = VoiceModeStatus.hearing;
    } else if (_ignored && (_active || _want)) {
      next = VoiceModeStatus.ignored;
    } else if (_unavailable && _want) {
      next = VoiceModeStatus.unavailable;
    } else if (_active || _want) {
      // 張り直しの合間も「聞き取り中」のまま見せる（点滅させない）
      next = VoiceModeStatus.listening;
    } else {
      next = VoiceModeStatus.paused;
    }
    if (next == _status) return;
    _status = next;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _restartTimer?.cancel();
    _ignoredTimer?.cancel();
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
