import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_command_parser.dart';

/// 音声入力のボトムシート
/// コマンドが確定したらVoiceCommandを返してポップする
class VoiceInputSheet extends ConsumerStatefulWidget {
  final VoiceCommandType? expectedType;
  final String? hint;

  const VoiceInputSheet({
    super.key,
    this.expectedType,
    this.hint,
  });

  /// ボトムシートを表示し、結果のVoiceCommandを返す
  static Future<VoiceCommand?> show(
    BuildContext context, {
    VoiceCommandType? expectedType,
    String? hint,
  }) {
    return showModalBottomSheet<VoiceCommand>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => VoiceInputSheet(
        expectedType: expectedType,
        hint: hint,
      ),
    );
  }

  @override
  ConsumerState<VoiceInputSheet> createState() => _VoiceInputSheetState();
}

class _VoiceInputSheetState extends ConsumerState<VoiceInputSheet>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    // 自動的にリスニング開始
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(voiceInputProvider.notifier).startListening();
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final voiceState = ref.watch(voiceInputProvider);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    // コマンドが解析されたら確認画面を表示
    ref.listen<VoiceInputState>(voiceInputProvider, (prev, next) {
      if (next.status == VoiceInputStatus.processing &&
          next.parsedCommand != null) {
        _pulseController.stop();
      }
    });

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ハンドル
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: colorScheme.onSurface.withOpacity(0.2),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 24),

            // 状態に応じたコンテンツ
            if (voiceState.status == VoiceInputStatus.processing &&
                voiceState.parsedCommand != null)
              _buildConfirmation(context, voiceState)
            else if (voiceState.hasError)
              _buildError(context, voiceState)
            else
              _buildListening(context, voiceState, colorScheme),

            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildListening(
    BuildContext context,
    VoiceInputState voiceState,
    ColorScheme colorScheme,
  ) {
    return Column(
      children: [
        // ヒントテキスト
        Text(
          widget.hint ?? _defaultHint,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurface.withOpacity(0.6),
              ),
        ),
        const SizedBox(height: 24),

        // マイクアイコン（パルスアニメーション付き）
        AnimatedBuilder(
          animation: _pulseAnimation,
          builder: (context, child) {
            final isActive = voiceState.isListening;
            return Container(
              width: 80 * (isActive ? _pulseAnimation.value : 1.0),
              height: 80 * (isActive ? _pulseAnimation.value : 1.0),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isActive
                    ? colorScheme.primary.withOpacity(0.15)
                    : colorScheme.surfaceContainerHighest,
              ),
              child: Icon(
                voiceState.isListening ? Icons.mic : Icons.mic_none,
                size: 40,
                color: voiceState.isListening
                    ? colorScheme.primary
                    : colorScheme.onSurface.withOpacity(0.5),
              ),
            );
          },
        ),
        const SizedBox(height: 16),

        // 認識テキスト表示
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          constraints: const BoxConstraints(minHeight: 48),
          child: Text(
            voiceState.recognizedText.isEmpty
                ? (voiceState.isListening ? '聞いています...' : '準備中...')
                : voiceState.recognizedText,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
            textAlign: TextAlign.center,
          ),
        ),
        const SizedBox(height: 24),

        // 操作ボタン
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextButton(
              onPressed: () {
                ref.read(voiceInputProvider.notifier).cancelListening();
                Navigator.pop(context);
              },
              child: const Text('キャンセル'),
            ),
            const SizedBox(width: 16),
            if (voiceState.isListening)
              FilledButton.icon(
                onPressed: () {
                  ref.read(voiceInputProvider.notifier).stopListening();
                },
                icon: const Icon(Icons.stop),
                label: const Text('完了'),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildConfirmation(BuildContext context, VoiceInputState voiceState) {
    final command = voiceState.parsedCommand!;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      children: [
        // コマンドタイプ表示
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: _commandColor(command.type, colorScheme).withOpacity(0.15),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _commandIcon(command.type),
                size: 16,
                color: _commandColor(command.type, colorScheme),
              ),
              const SizedBox(width: 6),
              Text(
                command.typeLabel,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: _commandColor(command.type, colorScheme),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // 認識されたテキスト
        Text(
          command.rawText,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: colorScheme.onSurface.withOpacity(0.6),
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),

        // パラメータ表示
        if (command.title != null)
          _paramRow(context, 'タイトル', command.title!),
        if (command.priority != null)
          _paramRow(context, '優先度', _priorityLabel(command.priority!)),
        if (command.reason != null)
          _paramRow(context, '理由', command.reason!),

        const SizedBox(height: 24),

        // 確認ボタン
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            OutlinedButton(
              onPressed: () {
                ref.read(voiceInputProvider.notifier).reset();
                ref.read(voiceInputProvider.notifier).startListening();
                _pulseController.repeat(reverse: true);
              },
              child: const Text('やり直す'),
            ),
            const SizedBox(width: 16),
            FilledButton.icon(
              onPressed: () {
                ref.read(voiceInputProvider.notifier).reset();
                Navigator.pop(context, command);
              },
              icon: const Icon(Icons.check),
              label: const Text('確定'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildError(BuildContext context, VoiceInputState voiceState) {
    final colorScheme = Theme.of(context).colorScheme;

    return Column(
      children: [
        Icon(Icons.mic_off, size: 48, color: colorScheme.error),
        const SizedBox(height: 16),
        Text(
          voiceState.errorMessage ?? '音声認識でエラーが発生しました',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: colorScheme.error,
              ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextButton(
              onPressed: () {
                ref.read(voiceInputProvider.notifier).reset();
                Navigator.pop(context);
              },
              child: const Text('閉じる'),
            ),
            const SizedBox(width: 16),
            FilledButton(
              onPressed: () {
                ref.read(voiceInputProvider.notifier).startListening();
              },
              child: const Text('再試行'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _paramRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withOpacity(0.5),
                  ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  String get _defaultHint {
    switch (widget.expectedType) {
      case VoiceCommandType.createTask:
        return 'タスクのタイトルを話してください';
      case VoiceCommandType.approveRequest:
        return '「承認」または「却下」と話してください';
      case VoiceCommandType.rejectRequest:
        return '却下理由を話してください';
      case VoiceCommandType.executeTask:
        return '「実行」と話してください';
      case VoiceCommandType.unknown:
      case null:
        return 'コマンドを話してください';
    }
  }

  IconData _commandIcon(VoiceCommandType type) {
    switch (type) {
      case VoiceCommandType.createTask:
        return Icons.add_task;
      case VoiceCommandType.approveRequest:
        return Icons.check_circle;
      case VoiceCommandType.rejectRequest:
        return Icons.cancel;
      case VoiceCommandType.executeTask:
        return Icons.play_arrow;
      case VoiceCommandType.unknown:
        return Icons.help;
    }
  }

  Color _commandColor(VoiceCommandType type, ColorScheme colorScheme) {
    switch (type) {
      case VoiceCommandType.createTask:
        return colorScheme.primary;
      case VoiceCommandType.approveRequest:
        return Colors.green;
      case VoiceCommandType.rejectRequest:
        return Colors.red;
      case VoiceCommandType.executeTask:
        return Colors.orange;
      case VoiceCommandType.unknown:
        return Colors.grey;
    }
  }

  String _priorityLabel(String priority) {
    switch (priority) {
      case 'urgent':
        return '緊急';
      case 'high':
        return '高';
      case 'medium':
        return '中';
      case 'low':
        return '低';
      default:
        return priority;
    }
  }
}
