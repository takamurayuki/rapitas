import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_recognition_error.dart';

class VoiceService {
  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;

  // NOTE: speech_to_text の onError / onStatus は initialize の1回目で固定されるため、
  // 聞き取りごとの受け手はここに持ち、_onError / _onStatus から渡す
  void Function(SpeechRecognitionError error)? _errorListener;
  void Function(String status)? _statusListener;

  bool get isInitialized => _isInitialized;
  bool get isListening => _speech.isListening;
  bool get isAvailable => _isInitialized && _speech.isAvailable;

  /// マイク（と iOS では音声認識）の権限があるか。initialize が false のときの理由の切り分けに使う
  Future<bool> get hasPermission => _speech.hasPermission;

  Future<bool> initialize() async {
    if (_isInitialized) return _speech.isAvailable;
    _isInitialized = await _speech.initialize(
      onError: _onError,
      onStatus: _onStatus,
    );
    return _isInitialized;
  }

  /// 聞き取りを始める。使えなければ何もせず false を返す。
  /// [onStatus] には speech_to_text の状態（listening / notListening / done）が届く。
  Future<bool> startListening({
    required void Function(SpeechRecognitionResult result) onResult,
    void Function(SpeechRecognitionError error)? onError,
    void Function(String status)? onStatus,
    String localeId = 'ja_JP',
    Duration? listenFor,
  }) async {
    if (!_isInitialized) {
      final available = await initialize();
      if (!available) return false;
    }

    _errorListener = onError;
    _statusListener = onStatus;
    await _speech.listen(
      onResult: onResult,
      localeId: localeId,
      listenFor: listenFor ?? const Duration(seconds: 30),
      pauseFor: const Duration(seconds: 3),
      cancelOnError: false,
      partialResults: true,
      listenMode: ListenMode.dictation,
    );
    return true;
  }

  Future<void> stopListening() async {
    await _speech.stop();
  }

  Future<void> cancelListening() async {
    _errorListener = null;
    _statusListener = null;
    await _speech.cancel();
  }

  Future<List<LocaleName>> getLocales() async {
    if (!_isInitialized) await initialize();
    return _speech.locales();
  }

  void _onError(SpeechRecognitionError error) => _errorListener?.call(error);

  void _onStatus(String status) => _statusListener?.call(status);

  void dispose() {
    _errorListener = null;
    _statusListener = null;
    if (_speech.isListening) {
      _speech.cancel();
    }
  }
}
