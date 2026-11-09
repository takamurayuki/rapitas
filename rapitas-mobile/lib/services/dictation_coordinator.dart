import 'package:flutter/foundation.dart';
import 'dictation_service.dart';

// 聞き取りの持ち主を1つにまとめる（音声操作モードの常時聞き取りと、前面の聞き取りの交通整理）。
//
// 端末の音声認識は1本しか同時に動かせない（speech_to_text は単一のインスタンス）。
// - 前面（foreground）：チャットの読み上げ入力・コマンドシート。これまでどおり DictationService として使う
// - 背面（background）：音声操作モードの常時聞き取り
// 前面が聞き取りを始めると、背面の聞き取りは捨てられる（onEnd は来ない）ので、
// [onBackgroundPreempted] で知らせる。前面が動いている間は [foregroundActive] が true。
// 前面・背面とも、自分が持っていない聞き取りを止めたり捨てたりはしない
// （チャット画面の後始末で常時聞き取りを止めてしまわないように）。
// 端末への開始・停止・取消は直列に流す。開始の完了を待つ間に取消や別の開始が来たら、
// 遅れて完了した開始は聞き取りを残さない（始まってしまったら即座に止める）。

class DictationCoordinator {
  DictationCoordinator(this._inner);

  final DictationService _inner;

  /// チャットの読み上げ入力・コマンドシート用
  late final DictationService foreground = _Handle(this, isBackground: false);

  /// 音声操作モードの常時聞き取り用
  late final DictationService background = _Handle(this, isBackground: true);

  /// 前面の聞き取り（チャットのマイク・コマンドシート）が動いているか
  final ValueNotifier<bool> foregroundActive = ValueNotifier(false);

  /// 前面の聞き取りが背面の聞き取りを押しのけたときに呼ぶ（押しのけられた側に onEnd は来ない）
  VoidCallback? onBackgroundPreempted;

  _Handle? _owner;

  /// 聞き取りを始めるたび・捨てるたびに増やす。古い聞き取りから遅れて届く結果や、
  /// 無効になった開始を見分けるため
  int _generation = 0;

  /// 端末への開始・停止・取消を1本の列に並べる（前の操作が終わるまで次を待たせる）
  Future<void> _queue = Future<void>.value();

  Future<T> _serial<T>(Future<T> Function() op) {
    final result = _queue.then((_) => op());
    _queue = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  Future<DictationStartFailure?> _start(
    _Handle handle, {
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    // 前面が動いている間は背面を始めない（呼ぶ側も確かめてから呼ぶ）
    if (handle.isBackground && foregroundActive.value) return DictationStartFailure.unavailable;
    // 持ち主はすぐに切り替える（後から来た取消・前面の開始が、この開始を無効にできるように）
    final generation = ++_generation;
    final previous = _owner;
    _owner = handle;
    if (!handle.isBackground) {
      foregroundActive.value = true;
      if (previous != null && previous.isBackground) onBackgroundPreempted?.call();
    }

    bool current() => generation == _generation && identical(_owner, handle);

    void release() {
      if (generation != _generation) return;
      _owner = null;
      if (!handle.isBackground) foregroundActive.value = false;
    }

    return _serial(() async {
      // 待っている間に取り消された・別の開始に替わった：始めない
      // （DictationService の約束どおり null を返し、呼び出し側は自分の状態で無視する）
      if (!current()) return null;
      DictationStartFailure? failure;
      try {
        failure = await _inner.start(
          onWords: (words) {
            if (generation == _generation) onWords(words);
          },
          onEnd: (end) {
            if (generation != _generation) return;
            release();
            onEnd(end);
          },
        );
      } catch (_) {
        if (generation != _generation) return null;
        release();
        rethrow;
      }
      if (generation != _generation) {
        // 開始を待っている間に無効になった：始まってしまった聞き取りは即座に止める
        if (failure == null) await _inner.cancel();
        return null;
      }
      if (failure != null) release();
      return failure;
    });
  }

  Future<void> _stop(_Handle handle) async {
    if (!identical(_owner, handle)) return;
    final generation = _generation;
    await _serial(() async {
      if (generation != _generation || !identical(_owner, handle)) return;
      await _inner.stop();
    });
  }

  Future<void> _cancel(_Handle handle) async {
    if (!identical(_owner, handle)) return;
    // 無効にするのはすぐ（待っている開始は始めず、進行中の開始は終わりしだい止める）
    _generation++;
    _owner = null;
    if (!handle.isBackground) foregroundActive.value = false;
    await _serial(() => _inner.cancel());
  }
}

class _Handle implements DictationService {
  _Handle(this._coordinator, {required this.isBackground});

  final DictationCoordinator _coordinator;
  final bool isBackground;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) =>
      _coordinator._start(this, onWords: onWords, onEnd: onEnd);

  @override
  Future<void> stop() => _coordinator._stop(this);

  @override
  Future<void> cancel() => _coordinator._cancel(this);
}
