import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_mode_listener.dart';

/// 音声操作モードの聞き取り表示（小さな丸い印。タップ範囲 40×40、見た目の丸は直径 [dotSize]）。
/// モードがオフの間は何も出さない（幅も取らない）。状態は「ランプ」＝色と動きだけで見せる（[VoiceModeDot]）。
/// マイク等の音声アイコンは使わない（チャット入力欄のマイクと意味が被るため）。
/// タップでコマンドシートを手で開ける（聞き取りに失敗したときの予備）。
///
/// 置き場所は各画面のタイトルバー（AppBar）の `actions` の先頭：既存のアイコン類はその右に並ぶ。
/// - 既存のアイコンがある画面：`const VoiceModeIndicator(trailing: false)` を先頭に置く。
/// - アイコンが無い画面：`const VoiceModeIndicator()` だけを置く（右端になる）。右に [trailingInset] の余白を取り、
///   丸の中心は画面の右端から 28px（= 標準の leading の中心と左右対称。ラピ画面のガラスのハンバーガーとも対称）。
/// キーボード表示中もタイトルバーは残るので出したまま（状態は一時停止になる）。ドロワー表示中は隠す。
class VoiceModeIndicator extends ConsumerStatefulWidget {
  const VoiceModeIndicator({super.key, this.trailing = true});

  /// バーの右端（actions の最後）に置くとき true：右に [trailingInset] の余白を取る。
  /// 既存のアイコンの左隣（先頭）に置くときは false（右のアイコンは従来どおり端まで並ぶ）。
  final bool trailing;

  /// 見た目の丸の直径
  static const double dotSize = 30;

  /// タップできる範囲（幅・高さ）
  static const double hitSize = 40;

  /// タイトルバーの中で取る幅（標準の IconButton と同じ 48。丸はその中央）
  static const double slotWidth = 48;

  /// 右端に置くときの画面の右端との間の余白（AppBar の actions には既定で余白が無い）
  static const double trailingInset = 4;

  static final ValueNotifier<int> _openDrawers = ValueNotifier(0);

  /// AppDrawer が開いた・閉じたときに呼ぶ（開いている間は隠す）
  static void drawerOpened() => _openDrawers.value++;
  static void drawerClosed() => _openDrawers.value = _openDrawers.value > 0 ? _openDrawers.value - 1 : 0;

  @override
  ConsumerState<VoiceModeIndicator> createState() => _VoiceModeIndicatorState();
}

class _VoiceModeIndicatorState extends ConsumerState<VoiceModeIndicator> {
  @override
  void initState() {
    super.initState();
    VoiceModeIndicator._openDrawers.addListener(_changed);
  }

  @override
  void dispose() {
    VoiceModeIndicator._openDrawers.removeListener(_changed);
    super.dispose();
  }

  /// NOTE: ドロワーの変化は build 中に届くことがあるので、そのときは次のフレームで描き直す
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
    final hidden = status == VoiceModeStatus.off || VoiceModeIndicator._openDrawers.value > 0;
    if (hidden) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsetsDirectional.only(end: widget.trailing ? VoiceModeIndicator.trailingInset : 0),
      child: SizedBox(
        width: VoiceModeIndicator.slotWidth,
        child: Center(
          child: VoiceModeDot(
            status: status,
            onTap: () => ref.read(voiceModeListenerProvider).openSheetManually(),
          ),
        ),
      ),
    );
  }
}

/// 聞き取り表示の丸そのもの（状態だけで描く。描画確認でも使う）。
/// アイコンは使わず、色と動きだけの「ランプ」で状態を表す：
/// - 聞き取り中：インディゴの丸がゆっくり明滅する
/// - 声が届いている：緑の丸から輪が広がる
/// - 実行中：紫の輪が回る
/// - コマンドではなかった：オレンジの丸に「？」（表示時間は VoiceModeListener 側の決まりのまま）
/// - 一時停止：グレーの丸（静止）
/// - 使えない：濃いグレーの丸に斜線
/// 丸は直径 [VoiceModeIndicator.dotSize]、動き（輪）はタップ範囲 [VoiceModeIndicator.hitSize] の内側に収める。
class VoiceModeDot extends StatefulWidget {
  final VoiceModeStatus status;
  final VoidCallback? onTap;

  const VoiceModeDot({super.key, required this.status, this.onTap});

  static const Color indigo = Color(0xFF5C6BC0);
  static const Color green = Color(0xFF43A047);
  static const Color purple = Color(0xFF8E24AA);
  static const Color orange = Color(0xFFFB8C00);
  static const Color grey = Color(0xFFB0B4BA);
  static const Color darkGrey = Color(0xFF5F6368);

  /// 明滅（聞き取り中）の 1 往復の半分
  static const Duration breatheHalf = Duration(milliseconds: 1400);

  /// 輪が広がる（声が届いている）1 回分
  static const Duration rippleCycle = Duration(milliseconds: 1400);

  /// 輪が 1 周する（実行中）時間
  static const Duration spinCycle = Duration(milliseconds: 1600);

  /// 丸の色
  static Color colorOf(VoiceModeStatus status) => switch (status) {
        VoiceModeStatus.listening => indigo,
        VoiceModeStatus.hearing => green,
        // 実行中は回る輪が主役なので、中の丸は薄い紫
        VoiceModeStatus.working => const Color(0x408E24AA),
        VoiceModeStatus.ignored => orange,
        VoiceModeStatus.unavailable => darkGrey,
        VoiceModeStatus.paused || VoiceModeStatus.off => grey,
      };

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
  State<VoiceModeDot> createState() => _VoiceModeDotState();
}

class _VoiceModeDotState extends State<VoiceModeDot> with SingleTickerProviderStateMixin {
  late final AnimationController _motion = AnimationController(vsync: this);

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(VoiceModeDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) _sync();
  }

  @override
  void dispose() {
    _motion.dispose();
    super.dispose();
  }

  /// 状態に合わせて動きを切り替える（動かない状態では止める）
  void _sync() {
    _motion.stop();
    switch (widget.status) {
      case VoiceModeStatus.listening:
        _motion.duration = VoiceModeDot.breatheHalf;
        _motion.value = 0;
        _motion.repeat(reverse: true);
      case VoiceModeStatus.hearing:
        _motion.duration = VoiceModeDot.rippleCycle;
        _motion.value = 0;
        _motion.repeat();
      case VoiceModeStatus.working:
        _motion.duration = VoiceModeDot.spinCycle;
        _motion.value = 0;
        _motion.repeat();
      case VoiceModeStatus.ignored ||
            VoiceModeStatus.unavailable ||
            VoiceModeStatus.paused ||
            VoiceModeStatus.off:
        _motion.value = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.status;
    final label = VoiceModeDot.labelOf(status);
    const dotSize = VoiceModeIndicator.dotSize;
    const hitSize = VoiceModeIndicator.hitSize;
    final color = VoiceModeDot.colorOf(status);

    final dot = AnimatedContainer(
      key: ValueKey('voice-mode-dot-${status.name}'),
      duration: const Duration(milliseconds: 180),
      width: dotSize,
      height: dotSize,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: status == VoiceModeStatus.working
            ? null
            : const [BoxShadow(color: Color(0x33000000), blurRadius: 3, offset: Offset(0, 1))],
      ),
      child: switch (status) {
        VoiceModeStatus.ignored => const Text(
            '?',
            key: ValueKey('voice-mode-question'),
            style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800, height: 1),
          ),
        VoiceModeStatus.unavailable => const CustomPaint(
            key: ValueKey('voice-mode-slash'),
            size: Size.square(dotSize),
            painter: _SlashPainter(),
          ),
        _ => null,
      },
    );

    final Widget lamp = switch (status) {
      // ゆっくり明滅（不透明度 1.0 ⇄ 0.45）
      VoiceModeStatus.listening => FadeTransition(
          key: const ValueKey('voice-mode-breathe'),
          opacity: _motion.drive(Tween(begin: 1.0, end: 0.45).chain(CurveTween(curve: Curves.easeInOut))),
          child: dot,
        ),
      // 丸の外側に輪が広がって消える
      VoiceModeStatus.hearing => Stack(
          alignment: Alignment.center,
          children: [
            CustomPaint(
              key: const ValueKey('voice-mode-ripple'),
              size: const Size.square(hitSize),
              painter: _RipplePainter(_motion, VoiceModeDot.green),
            ),
            dot,
          ],
        ),
      // 薄い丸の上で紫の輪が回る
      VoiceModeStatus.working => Stack(
          alignment: Alignment.center,
          children: [
            dot,
            CustomPaint(
              key: const ValueKey('voice-mode-spin'),
              size: const Size.square(dotSize),
              painter: _SpinPainter(_motion, VoiceModeDot.purple),
            ),
          ],
        ),
      _ => dot,
    };

    return Semantics(
      button: true,
      label: label,
      hint: 'タップでコマンドシートを開きます',
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        // 置き場所に Material が無くても波紋が出るよう、透明な Material を敷く
        child: Material(
          type: MaterialType.transparency,
          child: InkResponse(
            key: const ValueKey('voice-mode-indicator'),
            onTap: widget.onTap,
            radius: hitSize / 2,
            child: SizedBox(
              width: hitSize,
              height: hitSize,
              // 毎フレーム描き直す動き（明滅・輪・回転）を丸の中だけに閉じ込め、タイトルバー等まで描き直させない
              child: Center(
                child: RepaintBoundary(key: const ValueKey('voice-mode-lamp-boundary'), child: lamp),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 声が届いている：丸の縁（半径 15）からタップ範囲の縁（半径 20）まで輪が広がりながら薄くなる
class _RipplePainter extends CustomPainter {
  final Animation<double> t;
  final Color color;

  _RipplePainter(this.t, this.color) : super(repaint: t);

  @override
  void paint(Canvas canvas, Size size) {
    const inner = VoiceModeIndicator.dotSize / 2;
    final outer = size.shortestSide / 2 - 1;
    final v = Curves.easeOut.transform(t.value);
    final radius = inner + (outer - inner) * v;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..color = color.withValues(alpha: 0.55 * (1 - v));
    canvas.drawCircle(size.center(Offset.zero), radius, paint);
    // 丸のすぐ外のうすい縁（静止画でも「届いている」と分かるように）
    canvas.drawCircle(
      size.center(Offset.zero),
      inner + 1.5,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = color.withValues(alpha: 0.35),
    );
  }

  @override
  bool shouldRepaint(_RipplePainter old) => old.color != color;
}

/// 実行中：丸の内側の縁に沿って 3/4 周の輪が回る
class _SpinPainter extends CustomPainter {
  final Animation<double> t;
  final Color color;

  _SpinPainter(this.t, this.color) : super(repaint: t);

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 3.0;
    final rect = (Offset.zero & size).deflate(stroke / 2);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = color;
    canvas.drawArc(rect, -math.pi / 2 + t.value * 2 * math.pi, math.pi * 1.5, false, paint);
  }

  @override
  bool shouldRepaint(_SpinPainter old) => old.color != color;
}

/// 使えない：丸に斜線（左上から右下）
class _SlashPainter extends CustomPainter {
  const _SlashPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..color = Colors.white.withValues(alpha: 0.9);
    final d = size.shortestSide * 0.27;
    canvas.drawLine(Offset(d, d), Offset(size.width - d, size.height - d), paint);
  }

  @override
  bool shouldRepaint(_SlashPainter old) => false;
}
