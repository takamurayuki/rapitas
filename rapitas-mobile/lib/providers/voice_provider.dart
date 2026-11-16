import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/dictation_coordinator.dart';
import '../services/dictation_service.dart';
import '../services/voice_command_parser.dart';
import '../services/voice_mode_listener.dart';
import '../services/voice_route_tracker.dart';
import '../services/voice_service.dart';

/// VoiceServiceのプロバイダー
final voiceServiceProvider = Provider<VoiceService>((ref) {
  final service = VoiceService();
  ref.onDispose(() => service.dispose());
  return service;
});

/// 端末の聞き取り（speech_to_text）そのもの。テストでは偽物に差し替える
final speechDictationProvider = Provider<DictationService>((ref) {
  return SpeechDictationService(ref.watch(voiceServiceProvider));
});

/// 前面（チャット・コマンドシート）と背面（音声操作モードの常時聞き取り）の聞き取りの交通整理
final dictationCoordinatorProvider = Provider<DictationCoordinator>((ref) {
  return DictationCoordinator(ref.watch(speechDictationProvider));
});

/// 聞き取り1回分のラッパー（チャットの音声入力と、音声コマンドのシートで使う）。
/// 常時聞き取りと同時に動かないよう、交通整理の前面の口を渡す。テストでは偽物に差し替える
final dictationServiceProvider = Provider<DictationService>((ref) {
  return ref.watch(dictationCoordinatorProvider).foreground;
});

/// マイクと音声認識の許可を求める。許可されたら null、だめなら理由
typedef VoicePermissionRequest = Future<DictationStartFailure?> Function();

/// 音声操作モードをオンにするときの許可の確認。テストでは偽物に差し替える
final voicePermissionProvider = Provider<VoicePermissionRequest>((ref) {
  final voice = ref.watch(voiceServiceProvider);
  return () async {
    try {
      if (await voice.initialize()) return null;
      return await voice.hasPermission ? DictationStartFailure.unavailable : DictationStartFailure.permissionDenied;
    } catch (_) {
      return DictationStartFailure.unavailable;
    }
  };
});

/// 音声操作モードの常時聞き取り（状態は画面の聞き取り表示が見る）
final voiceModeListenerProvider = ChangeNotifierProvider<VoiceModeListener>((ref) {
  return VoiceModeListener(
    coordinator: ref.watch(dictationCoordinatorProvider),
    parser: ref.watch(voiceCommandParserProvider),
  );
});

/// VoiceCommandParserのプロバイダー
final voiceCommandParserProvider = Provider<VoiceCommandParser>((ref) {
  return VoiceCommandParser();
});

/// アプリのルーターに付けたシート・ダイアログの見張り。テストでは自前のルーターの分に差し替える
final voiceRouteTrackerProvider = Provider<VoiceRouteTracker>((ref) => appVoiceRouteTracker);

/// 音声コマンド「検索 ◯◯」の依頼。タスク一覧が受け取って検索を開き、null に戻す
final voiceTaskSearchRequestProvider = StateProvider<String?>((ref) => null);
