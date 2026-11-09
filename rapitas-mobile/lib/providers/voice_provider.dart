import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/dictation_service.dart';
import '../services/voice_command_parser.dart';
import '../services/voice_route_tracker.dart';
import '../services/voice_service.dart';

/// VoiceServiceのプロバイダー
final voiceServiceProvider = Provider<VoiceService>((ref) {
  final service = VoiceService();
  ref.onDispose(() => service.dispose());
  return service;
});

/// 聞き取り1回分のラッパー（チャットの音声入力と、音声コマンドのシートで使う）。
/// テストでは偽物に差し替える
final dictationServiceProvider = Provider<DictationService>((ref) {
  return SpeechDictationService(ref.watch(voiceServiceProvider));
});

/// VoiceCommandParserのプロバイダー
final voiceCommandParserProvider = Provider<VoiceCommandParser>((ref) {
  return VoiceCommandParser();
});

/// アプリのルーターに付けたシート・ダイアログの見張り。テストでは自前のルーターの分に差し替える
final voiceRouteTrackerProvider = Provider<VoiceRouteTracker>((ref) => appVoiceRouteTracker);

/// 音声コマンド「検索 ◯◯」の依頼。タスク一覧が受け取って検索を開き、null に戻す
final voiceTaskSearchRequestProvider = StateProvider<String?>((ref) => null);
