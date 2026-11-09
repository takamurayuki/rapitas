import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_command_flow.dart';

/// 音声コマンドのシート。開くと聞き取りを始め、解釈・対象の選択・確認・実行・結果までを
/// この中で見せる（流れは VoiceCommandFlow）。答えは声でもタップでも返せる。
class VoiceInputSheet extends ConsumerStatefulWidget {
  /// 話し始めた画面のパス（コマンドの文脈）
  final String path;
  final VoiceUi ui;

  /// 解釈を見せてから画面を操作するまで・成功後に閉じるまでの時間（テストで縮める）
  final Duration actionDelay;
  final Duration closeDelay;

  const VoiceInputSheet({
    super.key,
    required this.path,
    required this.ui,
    this.actionDelay = const Duration(milliseconds: 450),
    this.closeDelay = const Duration(milliseconds: 1500),
  });

  /// シートを開く（root の Navigator に積む。下タブのバーより手前に出す）
  static Future<void> show(
    BuildContext context, {
    required String path,
    required VoiceUi ui,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => VoiceInputSheet(path: path, ui: ui),
    );
  }

  @override
  ConsumerState<VoiceInputSheet> createState() => _VoiceInputSheetState();
}

class _VoiceInputSheetState extends ConsumerState<VoiceInputSheet>
    with SingleTickerProviderStateMixin {
  late final VoiceCommandFlow _flow;
  late final AnimationController _pulse;
  bool _attached = false;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
    _flow = VoiceCommandFlow(
      path: widget.path,
      dictation: ref.read(dictationServiceProvider),
      container: ProviderScope.containerOf(context, listen: false),
      parser: ref.read(voiceCommandParserProvider),
      ui: widget.ui,
      actionDelay: widget.actionDelay,
      closeDelay: widget.closeDelay,
    )..addListener(_onFlowChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _flow.start();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_attached) return;
    final route = ModalRoute.of(context);
    if (route != null) {
      _attached = true;
      widget.ui.attachSheet(route);
      ref.read(voiceRouteTrackerProvider).voiceSheetRoute = route;
    }
  }

  @override
  void dispose() {
    _flow.removeListener(_onFlowChanged);
    _flow.dispose();
    _pulse.dispose();
    super.dispose();
  }

  void _onFlowChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final flow = _flow;
    final maxHeight = MediaQuery.sizeOf(context).height * 0.8;
    final subtle = textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant);

    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: colorScheme.onSurface.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _Header(flow: flow, pulse: _pulse),
              const SizedBox(height: 12),
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _HeardBox(flow: flow),
                      if (flow.interpretation != null) ...[
                        const SizedBox(height: 10),
                        _InfoRow(icon: Icons.bolt, label: 'コマンド', text: flow.interpretation!),
                      ],
                      if (flow.note != null) ...[
                        const SizedBox(height: 6),
                        _InfoRow(icon: Icons.my_location, label: '対象', text: flow.note!),
                      ],
                      if (flow.prompt.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        Text(
                          flow.prompt,
                          key: const ValueKey('voice-prompt'),
                          style: textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: flow.phase == VoiceFlowPhase.failed ? colorScheme.error : null,
                          ),
                        ),
                      ],
                      if (flow.phase == VoiceFlowPhase.notUnderstood) ...[
                        const SizedBox(height: 6),
                        Text('ラピに送りますか？（「はい」「送って」で送ります）', style: subtle),
                      ],
                      if (flow.phase == VoiceFlowPhase.failed || flow.phase == VoiceFlowPhase.help) ...[
                        const SizedBox(height: 6),
                        Text('続けてコマンドを話せます（「閉じる」で閉じます）', style: subtle),
                      ],
                      if (flow.helpLines.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        for (final line in flow.helpLines) _Bullet(text: line),
                      ],
                      if (flow.choices.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        for (var i = 0; i < flow.choices.length; i++)
                          _ChoiceTile(
                            number: i + 1,
                            label: flow.choices[i],
                            onTap: () => flow.answer('${i + 1}'),
                          ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _Buttons(flow: flow),
            ],
          ),
        ),
      ),
    );
  }
}

/// 段階の札と、聞き取り中の表示
class _Header extends StatelessWidget {
  final VoiceCommandFlow flow;
  final Animation<double> pulse;

  const _Header({required this.flow, required this.pulse});

  (IconData, String, Color) _badge(ColorScheme cs) {
    switch (flow.phase) {
      case VoiceFlowPhase.listening:
        return (Icons.settings_voice, '音声コマンド', cs.primary);
      case VoiceFlowPhase.heardNothing:
        return (Icons.mic_off, '聞き取れませんでした', cs.onSurfaceVariant);
      case VoiceFlowPhase.choosing:
        return (Icons.format_list_numbered, '対象を選んでください', cs.primary);
      case VoiceFlowPhase.confirming:
        return (Icons.help_outline, '確認', Colors.orange.shade800);
      case VoiceFlowPhase.asking:
        return (Icons.edit_note, '入力', cs.primary);
      case VoiceFlowPhase.running:
        return (Icons.hourglass_top, '実行中', cs.primary);
      case VoiceFlowPhase.done:
        return (Icons.check_circle, '完了', Colors.green.shade700);
      case VoiceFlowPhase.failed:
        return (Icons.error_outline, 'できませんでした', cs.error);
      case VoiceFlowPhase.notUnderstood:
        return (Icons.help_center_outlined, '理解できませんでした', cs.onSurfaceVariant);
      case VoiceFlowPhase.help:
        return (Icons.menu_book_outlined, 'ヘルプ', cs.primary);
      case VoiceFlowPhase.cancelled:
        return (Icons.block, 'キャンセル', cs.onSurfaceVariant);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final (icon, label, color) = _badge(cs);
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                key: const ValueKey('voice-phase'),
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: color,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
        const Spacer(),
        if (flow.phase == VoiceFlowPhase.running)
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
        else if (flow.listening)
          FadeTransition(
            opacity: Tween<double>(begin: 0.35, end: 1).animate(pulse),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                ),
                const SizedBox(width: 6),
                Text('聞き取り中', style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
          ),
      ],
    );
  }
}

/// 認識した文
class _HeardBox extends StatelessWidget {
  final VoiceCommandFlow flow;

  const _HeardBox({required this.flow});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final heard = flow.heard.trim();
    final placeholder = flow.listening ? '話してください…' : '（聞き取った文はありません）';
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('認識した文', style: textTheme.labelSmall?.copyWith(color: cs.onSurfaceVariant)),
          const SizedBox(height: 4),
          Text(
            heard.isEmpty ? placeholder : heard,
            key: const ValueKey('voice-heard'),
            style: textTheme.bodyLarge?.copyWith(
              fontWeight: heard.isEmpty ? FontWeight.normal : FontWeight.w500,
              color: heard.isEmpty ? cs.onSurfaceVariant : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String text;

  const _InfoRow({required this.icon, required this.label, required this.text});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(icon, size: 16, color: cs.primary),
        ),
        const SizedBox(width: 6),
        SizedBox(
          width: 56,
          child: Text(label, style: textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.6)),
        ),
        Expanded(child: Text(text, style: textTheme.bodyMedium)),
      ],
    );
  }
}

class _Bullet extends StatelessWidget {
  final String text;

  const _Bullet({required this.text});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 8, right: 8),
            child: Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(color: cs.primary, shape: BoxShape.circle),
            ),
          ),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

class _ChoiceTile extends StatelessWidget {
  final int number;
  final String label;
  final VoidCallback onTap;

  const _ChoiceTile({required this.number, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          key: ValueKey('voice-choice-$number'),
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 12,
                  backgroundColor: cs.primary.withValues(alpha: 0.15),
                  child: Text(
                    '$number',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cs.primary),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 段階ごとの操作ボタン（声でもタップでも同じ答えになる）
class _Buttons extends StatelessWidget {
  final VoiceCommandFlow flow;

  const _Buttons({required this.flow});

  /// 流れの途中（聞き取り・選択・確認・入力）か
  bool get _inFlow => const {
        VoiceFlowPhase.listening,
        VoiceFlowPhase.heardNothing,
        VoiceFlowPhase.choosing,
        VoiceFlowPhase.confirming,
        VoiceFlowPhase.asking,
        VoiceFlowPhase.running,
      }.contains(flow.phase);

  @override
  Widget build(BuildContext context) {
    final buttons = <Widget>[
      TextButton(
        key: const ValueKey('voice-close'),
        onPressed: flow.dismiss,
        child: Text(_inFlow ? 'キャンセル' : '閉じる'),
      ),
    ];

    switch (flow.phase) {
      case VoiceFlowPhase.confirming:
        buttons.add(OutlinedButton(
          key: const ValueKey('voice-no'),
          onPressed: () => flow.answer('いいえ'),
          child: const Text('いいえ'),
        ));
        buttons.add(FilledButton(
          key: const ValueKey('voice-yes'),
          onPressed: () => flow.answer('はい'),
          child: const Text('はい'),
        ));
      case VoiceFlowPhase.asking:
        if (flow.choices.isNotEmpty) {
          buttons.add(OutlinedButton(
            key: const ValueKey('voice-none'),
            onPressed: () => flow.answer('なし'),
            child: const Text('なし'),
          ));
        }
        buttons.add(_speakButton());
      case VoiceFlowPhase.notUnderstood:
        if (!flow.listening) buttons.add(_againButton());
        buttons.add(FilledButton.icon(
          key: const ValueKey('voice-send-rapi'),
          onPressed: () => flow.answer('送って'),
          icon: const Icon(Icons.send, size: 18),
          label: const Text('ラピに送る'),
        ));
      case VoiceFlowPhase.running:
      case VoiceFlowPhase.done:
      case VoiceFlowPhase.cancelled:
        break;
      case VoiceFlowPhase.listening:
      case VoiceFlowPhase.heardNothing:
      case VoiceFlowPhase.choosing:
      case VoiceFlowPhase.failed:
      case VoiceFlowPhase.help:
        buttons.add(_speakButton());
    }

    return Wrap(
      alignment: WrapAlignment.end,
      spacing: 8,
      runSpacing: 8,
      children: buttons,
    );
  }

  /// 聞き取り中なら「完了」、止まっていれば「もう一度話す」
  Widget _speakButton() {
    if (flow.listening) {
      return FilledButton.tonalIcon(
        key: const ValueKey('voice-finish'),
        onPressed: flow.finishListening,
        icon: const Icon(Icons.stop, size: 18),
        label: const Text('完了'),
      );
    }
    return _againButton();
  }

  Widget _againButton() {
    return FilledButton.tonalIcon(
      key: const ValueKey('voice-again'),
      onPressed: flow.listenAgain,
      icon: const Icon(Icons.mic, size: 18),
      label: const Text('もう一度話す'),
    );
  }
}
