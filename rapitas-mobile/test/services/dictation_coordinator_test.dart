import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/dictation_coordinator.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/voice_command_flow.dart';
import 'package:rapitas_mobile/services/voice_command_parser.dart';
import 'package:rapitas_mobile/services/voice_mode_listener.dart';

class _FakeSpeech implements DictationService {
  int cancels = 0;
  void Function(String words)? onWords;
  void Function(DictationEnd end)? onEnd;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    this.onWords = onWords;
    this.onEnd = onEnd;
    return null;
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {
    cancels++;
    onWords = null;
    onEnd = null;
  }
}

/// 開始・取消がテストの合図まで終わらない偽物（端末の開始待ち・権限の確認待ちを模す）。
/// 最悪の場合に合わせ、開始待ちの間に来た取消は、遅れて完了した開始を止めない
/// （完了した時点でマイクが生きる）。操作が重なった数も数える
class _SlowSpeech implements DictationService {
  final _gates = <Completer<void>>[];
  final calls = <String>[];
  int _running = 0;
  int maxRunning = 0;
  void Function(String words)? liveWords;
  void Function(DictationEnd end)? liveEnd;

  /// マイクが生きているか
  bool get live => liveEnd != null;

  Future<void> _op(String name) async {
    calls.add(name);
    _running++;
    if (_running > maxRunning) maxRunning = _running;
    final gate = Completer<void>();
    _gates.add(gate);
    await gate.future;
    _running--;
  }

  /// 待っている操作をすべて終わらせる（終わった操作に続いて並ぶ操作も）。
  /// 重なっていたら、後から来た操作を先に終わらせる（取消が先に済み、開始が遅れて効く順）
  Future<void> drain() async {
    await pumpEventQueue();
    while (_gates.isNotEmpty) {
      _gates.removeLast().complete();
      await pumpEventQueue();
    }
  }

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    await _op('start');
    liveWords = onWords;
    liveEnd = onEnd;
    return null;
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {
    await _op('cancel');
    liveWords = null;
    liveEnd = null;
  }
}

class _Binding implements VoiceModeBinding {
  @override
  final ProviderContainer container = ProviderContainer();

  @override
  String currentPath() => '/tasks';

  @override
  VoiceUi createUi() => throw UnimplementedError();

  @override
  Future<void> openSheet(String path, {String? initialText}) async {}

  @override
  void onPermissionLost() {}
}

void main() {
  late _FakeSpeech speech;
  late DictationCoordinator c;

  setUp(() {
    speech = _FakeSpeech();
    c = DictationCoordinator(speech);
  });

  test('前面が始まると背面を押しのけ、背面には古い結果を届けない', () async {
    var preempted = 0;
    c.onBackgroundPreempted = () => preempted++;
    final bgWords = <String>[];
    var bgEnds = 0;
    await c.background.start(onWords: bgWords.add, onEnd: (_) => bgEnds++);
    final bgOnWords = speech.onWords!;
    final bgOnEnd = speech.onEnd!;
    expect(c.foregroundActive.value, isFalse);

    final fgEnds = <DictationEnd>[];
    await c.foreground.start(onWords: (_) {}, onEnd: fgEnds.add);
    expect(preempted, 1);
    expect(c.foregroundActive.value, isTrue);

    // 押しのけられた聞き取りから遅れて届いても捨てる
    bgOnWords('遅れて届いた文');
    bgOnEnd(DictationEnd.completed);
    expect(bgWords, isEmpty);
    expect(bgEnds, 0);

    speech.onEnd!(DictationEnd.completed);
    expect(fgEnds, [DictationEnd.completed]);
    expect(c.foregroundActive.value, isFalse);
  });

  test('前面が動いている間は背面を始めない', () async {
    await c.foreground.start(onWords: (_) {}, onEnd: (_) {});
    final failure = await c.background.start(onWords: (_) {}, onEnd: (_) {});
    expect(failure, DictationStartFailure.unavailable);
    expect(c.foregroundActive.value, isTrue);
  });

  test('自分が持っていない聞き取りは止めない（チャットの後始末で常時聞き取りを止めない）', () async {
    await c.background.start(onWords: (_) {}, onEnd: (_) {});
    await c.foreground.cancel();
    await c.foreground.stop();
    expect(speech.cancels, 0);
    expect(speech.onEnd, isNotNull);

    await c.background.cancel();
    expect(speech.cancels, 1);
  });

  test('前面を捨てたら foregroundActive が戻る', () async {
    await c.foreground.start(onWords: (_) {}, onEnd: (_) {});
    expect(c.foregroundActive.value, isTrue);
    await c.foreground.cancel();
    expect(c.foregroundActive.value, isFalse);
  });

  group('開始・取消の直列化（開始が遅れて完了する）', () {
    late _SlowSpeech slow;
    late DictationCoordinator sc;

    setUp(() {
      slow = _SlowSpeech();
      sc = DictationCoordinator(slow);
    });

    test('背面の開始を待つ間に取り消したら、開始が後から完了しても聞き取りは残らない', () async {
      final started = sc.background.start(onWords: (_) {}, onEnd: (_) {});
      await pumpEventQueue();
      expect(slow.calls, ['start']);

      final cancelled = sc.background.cancel();
      await slow.drain();
      expect(await started, isNull, reason: '取り消された開始は失敗ではなく null（呼び出し側は無視する）');
      await cancelled;

      expect(slow.live, isFalse, reason: 'モードをオフにしたのにマイクが動いている');
      expect(slow.maxRunning, 1, reason: '端末への開始と取消が重なった');
      expect(sc.foregroundActive.value, isFalse);
    });

    test('順番を待っている開始が取り消されたら、その開始は端末に届けない', () async {
      final first = sc.background.start(onWords: (_) {}, onEnd: (_) {});
      final second = sc.background.start(onWords: (_) {}, onEnd: (_) {}); // 1本目の完了待ち
      await pumpEventQueue();
      final cancelled = sc.background.cancel();
      await slow.drain();
      expect(await first, isNull);
      expect(await second, isNull);
      await cancelled;
      // 1本目は始まってしまったので止める。2本目は始めない。最後に取消
      expect(slow.calls, ['start', 'cancel', 'cancel']);
      expect(slow.live, isFalse);
      expect(slow.maxRunning, 1);
    });

    test('背面の開始が完了する前に前面が始まっても、前面の聞き取りを上書きしない', () async {
      var preempted = 0;
      sc.onBackgroundPreempted = () => preempted++;
      final bgWords = <String>[];
      final fgWords = <String>[];
      final fgEnds = <DictationEnd>[];
      final bg = sc.background.start(onWords: bgWords.add, onEnd: (_) {});
      await pumpEventQueue();

      final fg = sc.foreground.start(onWords: fgWords.add, onEnd: fgEnds.add);
      expect(preempted, 1);
      expect(sc.foregroundActive.value, isTrue);
      await slow.drain();
      expect(await bg, isNull);
      expect(await fg, isNull);

      // 最後に端末で動いているのは前面の聞き取り
      expect(slow.live, isTrue);
      slow.liveWords!('前面の文');
      slow.liveEnd!(DictationEnd.completed);
      expect(fgWords, ['前面の文'], reason: '遅れて完了した背面の開始が前面を上書きした');
      expect(bgWords, isEmpty);
      expect(fgEnds, [DictationEnd.completed]);
      expect(sc.foregroundActive.value, isFalse);
      expect(slow.maxRunning, 1);
    });

    test('常時聞き取り：開始の途中でモードをオフにしても、完了後に聞き取りが残らない', () async {
      final listener = VoiceModeListener(
        coordinator: sc,
        parser: VoiceCommandParser(),
        restartDelay: Duration.zero,
        quickEnd: Duration.zero,
      );
      final binding = _Binding();
      addTearDown(() {
        listener.dispose();
        binding.container.dispose();
      });
      listener.attach(binding);
      listener.update(enabled: true, allowed: true);
      await pumpEventQueue();
      expect(slow.calls, ['start'], reason: '張り直しのタイマーから開始が出ている');
      expect(listener.isListening, isTrue);

      listener.update(enabled: false, allowed: true);
      await slow.drain();
      expect(slow.live, isFalse, reason: '表示はオフなのにマイクが動いている');
      expect(listener.isListening, isFalse);
      expect(listener.status, VoiceModeStatus.off);
      expect(slow.maxRunning, 1);
    });
  });
}
