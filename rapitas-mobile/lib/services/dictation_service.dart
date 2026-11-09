import 'dart:async';

import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'voice_service.dart';

// チャット（ラピ）の音声入力で使う、聞き取り1回分の小さなラッパー。
//
// 画面は speech_to_text を直接触らず、これだけを使う（テストでは偽物に差し替える）。
// 聞き取りの終わり方（無音での自動終了・手動の停止・上限時間・エラー）は
// ここで onEnd の1回にまとめ、画面は「終わったら欄の文を送るかどうか」だけを決める。

/// 聞き取りを始められなかった理由
enum DictationStartFailure {
  /// マイク／音声認識の権限が無い（拒否された）
  permissionDenied,

  /// 端末で音声認識が使えない
  unavailable,
}

/// 聞き取りの終わり方
enum DictationEnd {
  /// 普通に終わった（無音での自動終了・停止・上限時間）
  completed,

  /// 何も聞き取れなかった（no_match・speech_timeout）
  noSpeech,

  /// 認識に失敗した（ネットワーク・音声デバイスなど）
  failed,
}

abstract class DictationService {
  /// 権限を確認して聞き取りを始める。始められたら null、だめなら理由を返す。
  /// 端末側の開始処理が例外を投げたときも投げ返さず、[DictationStartFailure.unavailable] を返す。
  /// [onWords] には途中経過を含む認識結果（その時点の全文）が届く。
  /// [onEnd] は聞き取り1回につき必ず1回だけ呼ぶ（[cancel] したときは呼ばない）。
  /// NOTE: 開始待ち（権限の確認を含む）の間に [cancel] されたときは、その後に失敗や例外が来ても
  /// 後始末に触らず null を返す（呼び出し側は自分の状態で無視する）。
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  });

  /// 聞き取りを終える（確定した結果のあとに onEnd が呼ばれる）
  Future<void> stop();

  /// 聞き取りを捨てる（onEnd は呼ばない）。画面を離れるときに使う
  Future<void> cancel();
}

/// チャットの聞き取りの上限（無音の猶予 3 秒は VoiceService の pauseFor）
const Duration chatDictationListenFor = Duration(seconds: 30);

/// stop() のあと、確定結果や done が来ないときに打ち切るまでの時間
const Duration _stopGrace = Duration(seconds: 2);

class SpeechDictationService implements DictationService {
  final VoiceService _voice;

  SpeechDictationService(this._voice);

  _Session? _session;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    await cancel();
    final session = _Session(onWords, onEnd);
    _session = session;

    try {
      final available = await _voice.initialize();
      // 開始待ちの間に cancel（画面を離れた・次の聞き取り）されていたら、そちらが後始末済み。
      // 以降は後始末に触らず null を返す（触ると次の聞き取りまで止めてしまう）
      if (session.ended) return null;
      if (!available) {
        // NOTE: 権限の確認が終わるまでセッションを保持する。先に外すと、待ちの間の
        // cancel → 次の開始 のあとに例外が来たとき、catch が次の聞き取りを止めてしまう
        final permitted = await _voice.hasPermission;
        if (session.ended) return null;
        session.ended = true;
        if (identical(_session, session)) _session = null;
        return permitted ? DictationStartFailure.unavailable : DictationStartFailure.permissionDenied;
      }

      final started = await _voice.startListening(
        localeId: 'ja_JP',
        listenFor: chatDictationListenFor,
        onResult: (r) => _onResult(session, r),
        onError: (e) => _onError(session, e),
        onStatus: (s) => _onStatus(session, s),
      );
      if (!started) {
        if (session.ended) return null;
        session.ended = true;
        if (identical(_session, session)) _session = null;
        return DictationStartFailure.unavailable;
      }
      return null;
    } catch (_) {
      // NOTE: speech_to_text は端末側の開始失敗を例外で返すことがある。
      // 途中まで始まっていても残さないよう後始末し、「使えない」として返す。
      // 開始待ち（権限の確認を含む）の間に cancel されていたら、上と同じく触らず null を返す
      if (session.ended) return null;
      session.ended = true;
      if (identical(_session, session)) _session = null;
      try {
        await _voice.cancelListening();
      } catch (_) {}
      return DictationStartFailure.unavailable;
    }
  }

  void _onResult(_Session session, SpeechRecognitionResult result) {
    if (session.ended) return;
    session.onWords(result.recognizedWords);
    if (result.finalResult) _finish(session, DictationEnd.completed);
  }

  void _onError(_Session session, SpeechRecognitionError error) {
    if (session.ended) return;
    const noSpeech = {'error_no_match', 'error_speech_timeout'};
    _finish(session, noSpeech.contains(error.errorMsg) ? DictationEnd.noSpeech : DictationEnd.failed);
    _voice.cancelListening();
  }

  void _onStatus(_Session session, String status) {
    // NOTE: Android は確定結果の前に notListening が来るので、終わりは done だけで判断する
    if (status == SpeechToText.doneStatus) _finish(session, DictationEnd.completed);
  }

  void _finish(_Session session, DictationEnd end) {
    if (session.ended) return;
    session.ended = true;
    session.stopTimer?.cancel();
    if (identical(_session, session)) _session = null;
    session.onEnd(end);
  }

  @override
  Future<void> stop() async {
    final session = _session;
    if (session == null) return;
    session.stopTimer ??= Timer(_stopGrace, () => _finish(session, DictationEnd.completed));
    await _voice.stopListening();
  }

  @override
  Future<void> cancel() async {
    final session = _session;
    if (session == null) return;
    session.ended = true;
    session.stopTimer?.cancel();
    _session = null;
    await _voice.cancelListening();
  }
}

class _Session {
  final void Function(String words) onWords;
  final void Function(DictationEnd end) onEnd;
  bool ended = false;
  Timer? stopTimer;

  _Session(this.onWords, this.onEnd);
}
