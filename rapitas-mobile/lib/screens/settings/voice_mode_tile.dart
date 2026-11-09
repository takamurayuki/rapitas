import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/settings_provider.dart';
import '../../providers/voice_provider.dart';
import '../../services/dictation_service.dart';

/// 許可されなかったときの理由
const String voiceModePermissionMessage = 'マイクと音声認識が許可されていないため、音声操作モードをオンにできませんでした。設定アプリで rapitas のマイクと音声認識を許可してください。';
const String voiceModeUnavailableMessage = 'この端末では音声認識を使えないため、音声操作モードをオンにできませんでした。';

/// 設定の「音声操作モード」のスイッチ。
/// オンにするときにマイクと音声認識の許可を求め、許可されなければオフのまま理由を出す
class VoiceModeTile extends ConsumerStatefulWidget {
  const VoiceModeTile({super.key});

  @override
  ConsumerState<VoiceModeTile> createState() => _VoiceModeTileState();
}

class _VoiceModeTileState extends ConsumerState<VoiceModeTile> {
  /// 許可を確認している間（スイッチはオンに見せる）
  bool _requesting = false;

  /// オンにできなかった理由（次に切り替えるまで出しておく）
  String? _error;

  Future<void> _onChanged(bool on) async {
    final notifier = ref.read(voiceCommandModeProvider.notifier);
    if (!on) {
      setState(() => _error = null);
      await notifier.setEnabled(false);
      return;
    }
    setState(() {
      _requesting = true;
      _error = null;
    });
    final failure = await ref.read(voicePermissionProvider)();
    if (!mounted) return;
    if (failure == null) {
      setState(() => _requesting = false);
      await notifier.setEnabled(true);
      return;
    }
    final message = failure == DictationStartFailure.permissionDenied
        ? voiceModePermissionMessage
        : voiceModeUnavailableMessage;
    setState(() {
      _requesting = false;
      _error = message;
    });
    await notifier.setEnabled(false);
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final enabled = ref.watch(voiceCommandModeProvider);
    final cs = Theme.of(context).colorScheme;
    final error = _error;
    return SwitchListTile(
      key: const ValueKey('voice-mode-switch'),
      secondary: const Icon(Icons.settings_voice),
      title: const Text('音声操作モード'),
      subtitle: Text(
        error ??
            (enabled
                ? 'オン：アプリを開いている間、音声コマンドを聞き取ります'
                : 'オンにすると、アプリを開いている間は話しかけるだけで操作できます'),
        style: error != null ? TextStyle(color: cs.error) : null,
      ),
      value: enabled || _requesting,
      onChanged: _requesting ? null : _onChanged,
    );
  }
}
