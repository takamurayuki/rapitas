import 'package:flutter/material.dart';
import '../services/voice_command_parser.dart';
import 'voice_input_sheet.dart';

/// 音声入力を開始するFloatingActionButton
class VoiceFab extends StatelessWidget {
  final VoiceCommandType? expectedType;
  final String? hint;
  final void Function(VoiceCommand command) onCommand;
  final Widget? child;
  final bool mini;

  const VoiceFab({
    super.key,
    this.expectedType,
    this.hint,
    required this.onCommand,
    this.child,
    this.mini = false,
  });

  @override
  Widget build(BuildContext context) {
    return FloatingActionButton(
      mini: mini,
      heroTag: 'voice_fab_${expectedType?.name ?? 'default'}',
      onPressed: () async {
        final command = await VoiceInputSheet.show(
          context,
          expectedType: expectedType,
          hint: hint,
        );
        if (command != null) {
          onCommand(command);
        }
      },
      child: child ?? const Icon(Icons.mic),
    );
  }
}
