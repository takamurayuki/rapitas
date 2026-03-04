import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_recognition_error.dart';

class VoiceService {
  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;

  bool get isInitialized => _isInitialized;
  bool get isListening => _speech.isListening;
  bool get isAvailable => _isInitialized && _speech.isAvailable;

  Future<bool> initialize() async {
    if (_isInitialized) return _speech.isAvailable;
    _isInitialized = await _speech.initialize(
      onError: _onError,
      onStatus: _onStatus,
    );
    return _isInitialized;
  }

  Future<void> startListening({
    required void Function(SpeechRecognitionResult result) onResult,
    void Function(SpeechRecognitionError error)? onError,
    String localeId = 'ja_JP',
    Duration? listenFor,
  }) async {
    if (!_isInitialized) {
      final available = await initialize();
      if (!available) return;
    }

    await _speech.listen(
      onResult: onResult,
      localeId: localeId,
      listenFor: listenFor ?? const Duration(seconds: 30),
      pauseFor: const Duration(seconds: 3),
      cancelOnError: false,
      partialResults: true,
      listenMode: ListenMode.dictation,
    );
  }

  Future<void> stopListening() async {
    await _speech.stop();
  }

  Future<void> cancelListening() async {
    await _speech.cancel();
  }

  Future<List<LocaleName>> getLocales() async {
    if (!_isInitialized) await initialize();
    return _speech.locales();
  }

  void _onError(SpeechRecognitionError error) {
    // Handled via onError callback in startListening
  }

  void _onStatus(String status) {
    // Status updates: listening, notListening, done
  }

  void dispose() {
    if (_speech.isListening) {
      _speech.cancel();
    }
  }
}
