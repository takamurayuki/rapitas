import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import '../services/voice_service.dart';
import '../services/voice_command_parser.dart';

/// 音声入力の状態
enum VoiceInputStatus {
  idle,
  initializing,
  listening,
  processing,
  error,
}

/// 音声入力の状態モデル
class VoiceInputState {
  final VoiceInputStatus status;
  final String recognizedText;
  final String? errorMessage;
  final VoiceCommand? parsedCommand;
  final double soundLevel;

  const VoiceInputState({
    this.status = VoiceInputStatus.idle,
    this.recognizedText = '',
    this.errorMessage,
    this.parsedCommand,
    this.soundLevel = 0,
  });

  bool get isListening => status == VoiceInputStatus.listening;
  bool get isIdle => status == VoiceInputStatus.idle;
  bool get hasError => status == VoiceInputStatus.error;
  bool get hasResult => recognizedText.isNotEmpty;

  VoiceInputState copyWith({
    VoiceInputStatus? status,
    String? recognizedText,
    String? errorMessage,
    VoiceCommand? parsedCommand,
    double? soundLevel,
    bool clearError = false,
    bool clearCommand = false,
  }) {
    return VoiceInputState(
      status: status ?? this.status,
      recognizedText: recognizedText ?? this.recognizedText,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      parsedCommand: clearCommand ? null : (parsedCommand ?? this.parsedCommand),
      soundLevel: soundLevel ?? this.soundLevel,
    );
  }
}

/// VoiceServiceのプロバイダー
final voiceServiceProvider = Provider<VoiceService>((ref) {
  final service = VoiceService();
  ref.onDispose(() => service.dispose());
  return service;
});

/// VoiceCommandParserのプロバイダー
final voiceCommandParserProvider = Provider<VoiceCommandParser>((ref) {
  return VoiceCommandParser();
});

/// 音声入力状態のStateNotifier
class VoiceInputNotifier extends StateNotifier<VoiceInputState> {
  final VoiceService _voiceService;
  final VoiceCommandParser _parser;

  VoiceInputNotifier(this._voiceService, this._parser)
      : super(const VoiceInputState());

  Future<void> startListening() async {
    state = state.copyWith(
      status: VoiceInputStatus.initializing,
      recognizedText: '',
      clearError: true,
      clearCommand: true,
    );

    final available = await _voiceService.initialize();
    if (!available) {
      state = state.copyWith(
        status: VoiceInputStatus.error,
        errorMessage: '音声認識が利用できません。マイクの権限を確認してください。',
      );
      return;
    }

    state = state.copyWith(status: VoiceInputStatus.listening);

    await _voiceService.startListening(
      onResult: _onResult,
    );
  }

  void _onResult(SpeechRecognitionResult result) {
    state = state.copyWith(recognizedText: result.recognizedWords);

    if (result.finalResult) {
      final command = _parser.parse(result.recognizedWords);
      state = state.copyWith(
        status: VoiceInputStatus.processing,
        parsedCommand: command,
      );
    }
  }

  Future<void> stopListening() async {
    await _voiceService.stopListening();
    if (state.recognizedText.isNotEmpty) {
      final command = _parser.parse(state.recognizedText);
      state = state.copyWith(
        status: VoiceInputStatus.processing,
        parsedCommand: command,
      );
    } else {
      state = state.copyWith(status: VoiceInputStatus.idle);
    }
  }

  Future<void> cancelListening() async {
    await _voiceService.cancelListening();
    state = const VoiceInputState();
  }

  void reset() {
    state = const VoiceInputState();
  }
}

/// 音声入力状態のプロバイダー
final voiceInputProvider =
    StateNotifierProvider<VoiceInputNotifier, VoiceInputState>((ref) {
  final voiceService = ref.watch(voiceServiceProvider);
  final parser = ref.watch(voiceCommandParserProvider);
  return VoiceInputNotifier(voiceService, parser);
});
