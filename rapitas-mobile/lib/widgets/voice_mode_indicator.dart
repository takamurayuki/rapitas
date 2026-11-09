import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_mode_listener.dart';
import '../services/voice_route_tracker.dart';

/// 音声操作モードの聞き取り表示（小さな丸い印。タップ範囲 40×40、見た目の丸は直径 [dotSize]）。
/// モードがオフの間は何も出さない。文字の帯は出さず、色とアイコンだけで状態を見せる：
/// 聞き取り中（塗りの丸＋マイク）・声が届いている（外側の輪）・コマンドではなかった（「？」・少しの間）・
/// 止めている（薄いマイク）・聞き取れない（赤いマイク斜線）。
/// タップでコマンドシートを手で開ける（聞き取りに失敗したときの予備）。
///
/// 置き場所は以前の音声ボタンと同じ左下：下タブの画面はシェルの Scaffold（startFloat）、
/// push で開く画面は [VoiceIndicatorFrame]、チャット画面は入力欄の上。右下の各画面の FAB や下タブとは重ならない。
/// キーボード表示中・ドロワー表示中・下タブ側にシートが出ている間は隠す。
class VoiceModeIndicator extends ConsumerStatefulWidget {
  /// 下タブ側（ShellRoute の Navigator）にシート・ダイアログが出ている間は隠すか。
  /// シェルの FAB の枠は本文より手前に描かれるため、隠さないとシートの上に浮いてしまう
  final bool hideOverShellPopups;

  const VoiceModeIndicator({super.key, this.hideOverShellPopups = false});

  /// 見た目の丸の直径
  static const double dotSize = 30;

  /// タップできる範囲（幅・高さ）
  static const double hitSize = 40;

  static final ValueNotifier<int> _openDrawers = ValueNotifier(0);

  /// AppDrawer が開いた・閉じたときに呼ぶ（開いている間は隠す）
  static void drawerOpened() => _openDrawers.value++;
  static void drawerClosed() => _openDrawers.value = _openDrawers.value > 0 ? _openDrawers.value - 1 : 0;

  @override
  ConsumerState<VoiceModeIndicator> createState() => _VoiceModeIndicatorState();
}

class _VoiceModeIndicatorState extends ConsumerState<VoiceModeIndicator> {
  VoiceRouteTracker? _tracker;

  @override
  void initState() {
    super.initState();
    VoiceModeIndicator._openDrawers.addListener(_changed);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final tracker = ref.read(voiceRouteTrackerProvider);
    if (!identical(tracker, _tracker)) {
      _tracker?.removeListener(_changed);
      _tracker = tracker..addListener(_changed);
    }
  }

  @override
  void dispose() {
    VoiceModeIndicator._openDrawers.removeListener(_changed);
    _tracker?.removeListener(_changed);
    super.dispose();
  }

  /// NOTE: ドロワー・Navigator の変化は build 中に届くことがあるので、そのときは次のフレームで描き直す
  void _changed() {
    if (!mounted) return;
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    } else {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(voiceModeListenerProvider.select((l) => l.status));
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    final hidden = status == VoiceModeStatus.off ||
        keyboardOpen ||
        VoiceModeIndicator._openDrawers.value > 0 ||
        (widget.hideOverShellPopups && (_tracker?.hasShellPopup ?? false));
    if (hidden) return const SizedBox.shrink();
    return VoiceModeDot(
      status: status,
      onTap: () => ref.read(voiceModeListenerProvider).openSheetManually(),
    );
  }
}

/// 聞き取り表示の丸そのもの（状態だけで描く。描画確認でも使う）
class VoiceModeDot extends StatelessWidget {
  final VoiceModeStatus status;
  final VoidCallback? onTap;

  const VoiceModeDot({super.key, required this.status, this.onTap});

  static String labelOf(VoiceModeStatus status) {
    switch (status) {
      case VoiceModeStatus.off:
        return '音声操作モードはオフです';
      case VoiceModeStatus.paused:
        return '音声操作：一時停止中';
      case VoiceModeStatus.listening:
        return '音声操作：聞き取り中';
      case VoiceModeStatus.hearing:
        return '音声操作：聞こえています';
      case VoiceModeStatus.working:
        return '音声操作：実行中';
      case VoiceModeStatus.ignored:
        return '音声操作：コマンドではなかったので聞き流しました';
      case VoiceModeStatus.unavailable:
        return '音声操作：聞き取りを始められません';
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final (Color bg, Color fg, IconData icon) = switch (status) {
      VoiceModeStatus.listening => (cs.primary, cs.onPrimary, Icons.mic),
      VoiceModeStatus.hearing => (cs.primary, cs.onPrimary, Icons.graphic_eq),
      VoiceModeStatus.working => (cs.primary, cs.onPrimary, Icons.more_horiz),
      VoiceModeStatus.ignored => (cs.surface, cs.onSurfaceVariant, Icons.question_mark),
      VoiceModeStatus.unavailable => (cs.errorContainer, cs.error, Icons.mic_off),
      VoiceModeStatus.paused || VoiceModeStatus.off => (
          cs.surfaceContainerHighest,
          cs.onSurfaceVariant.withValues(alpha: 0.7),
          Icons.mic_none
        ),
    };
    final filled = bg == cs.primary;
    final hearing = status == VoiceModeStatus.hearing;
    final label = labelOf(status);
    return Semantics(
      button: true,
      label: label,
      hint: 'タップでコマンドシートを開きます',
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        // FAB の枠には Material が無いので、波紋のために透明な Material を敷く
        child: Material(
          type: MaterialType.transparency,
          child: InkResponse(
          key: const ValueKey('voice-mode-indicator'),
          onTap: onTap,
          radius: VoiceModeIndicator.hitSize / 2,
          child: SizedBox(
            width: VoiceModeIndicator.hitSize,
            height: VoiceModeIndicator.hitSize,
            child: Center(
              child: AnimatedContainer(
                key: ValueKey('voice-mode-dot-${status.name}'),
                duration: const Duration(milliseconds: 180),
                width: VoiceModeIndicator.dotSize,
                height: VoiceModeIndicator.dotSize,
                decoration: BoxDecoration(
                  color: bg,
                  shape: BoxShape.circle,
                  border: filled ? null : Border.all(color: cs.outlineVariant),
                  boxShadow: [
                    // 声が届いている間は外側に輪を出す（幅は hitSize の内側に収まる）
                    if (hearing) BoxShadow(color: cs.primary.withValues(alpha: 0.3), spreadRadius: 4),
                    const BoxShadow(color: Color(0x33000000), blurRadius: 4, offset: Offset(0, 1)),
                  ],
                ),
                child: Icon(icon, size: 16, color: fg),
              ),
            ),
          ),
        ),
        ),
      ),
    );
  }
}

/// push で開く画面（シェルの外）に聞き取り表示を付ける枠。
/// 外側の Scaffold が表示とスナックバーを受け持つ（スナックバーが出ると表示が上へよける）
class VoiceIndicatorFrame extends StatelessWidget {
  final Widget child;

  const VoiceIndicatorFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // キーボードは中の画面の Scaffold に任せる（表示はキーボード表示中は隠れる）
      resizeToAvoidBottomInset: false,
      body: child,
      floatingActionButton: const VoiceModeIndicator(),
      floatingActionButtonLocation: FloatingActionButtonLocation.startFloat,
    );
  }
}
