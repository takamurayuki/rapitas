import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// 瞬きの1周期（デスクトップ RapiAvatar.tsx の `<animate dur="4.5s">`）
const Duration rapiBlinkCycle = Duration(milliseconds: 4500);

/// 目を閉じ始める時刻（周期に対する比率。keyTimes の 0.92）
const double rapiBlinkCloseStart = 0.92;

/// 目がいちばん細くなる時刻（keyTimes の 0.96）
const double rapiBlinkClosed = 0.96;

/// 開いた目の ry（viewBox 120 座標。デスクトップの idle の点の目）
const double rapiEyeRy = 5.8;

/// 閉じた瞬間の ry（values の 0.6）
const double rapiEyeClosedRy = 0.6;

/// 周期内の位置 [phase]（0〜1）での、開いた目に対する ry の比率。
///
/// デスクトップの `values="5.8;5.8;0.6;5.8" keyTimes="0;0.92;0.96;1"`（区間は線形）を
/// 5.8 で割ったもの。0〜0.92 は 1、0.96 で 0.6/5.8、1 で 1 に戻る。
double rapiBlinkRyRatio(double phase) {
  const closed = rapiEyeClosedRy / rapiEyeRy;
  final p = phase - phase.floorToDouble();
  if (p <= rapiBlinkCloseStart) return 1;
  if (p <= rapiBlinkClosed) {
    final t = (p - rapiBlinkCloseStart) / (rapiBlinkClosed - rapiBlinkCloseStart);
    return 1 + (closed - 1) * t;
  }
  final t = (p - rapiBlinkClosed) / (1 - rapiBlinkClosed);
  return closed + (1 - closed) * t;
}

/// ラピ本人（デスクトップ RapiAvatar.tsx の idle・light）。目だけはデスクトップと同じ
/// タイミングで瞬く。
///
/// [size] はデスクトップと同じく本体の箱（viewBox 120×120）の大きさで、
/// レイアウト上もこの正方形を占める。足元の影はデスクトップ同様この箱の下に
/// はみ出して描かれる（SVG は影の分だけ縦に 134 まで伸ばしてある）。
/// 目は assets/rapi_avatar.svg には入っておらず、[RapiEyesPainter] で重ねて描く
/// （flutter_svg は SVG のアニメーションを再生しないため）。
/// MediaQuery.disableAnimations のときは瞬かない（デスクトップの animate ゲート）。
class RapiAvatar extends StatefulWidget {
  /// SVG の高さ / 本体の箱の高さ（assets/rapi_avatar.svg の viewBox 120×134）
  static const double _svgAspect = 134 / 120;

  final double size;

  const RapiAvatar({super.key, required this.size});

  @override
  State<RapiAvatar> createState() => _RapiAvatarState();
}

class _RapiAvatarState extends State<RapiAvatar> with SingleTickerProviderStateMixin {
  // NOTE: 周期全体を AnimationController.repeat() で回さない。開いている 0〜92% の間も
  // 毎フレーム描き直すことになり、pumpAndSettle を使う既存の画面テストが終わらなくなる
  // （電池にも無駄）。開いている間はタイマーで待ち、閉じて開く 92〜100% だけ動かす。
  late final AnimationController _blink = AnimationController(
    vsync: this,
    duration: rapiBlinkCycle * (1 - rapiBlinkCloseStart),
  )..addStatusListener(_onBlinkStatus);

  Timer? _hold;
  bool _animate = false;

  /// 周期内の位置。瞬いていないときは 0.92（開いたまま）。
  double get _phase => rapiBlinkCloseStart + (1 - rapiBlinkCloseStart) * _blink.value;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animate = !(MediaQuery.maybeDisableAnimationsOf(context) ?? false);
    if (animate == _animate) return;
    _animate = animate;
    _hold?.cancel();
    _hold = null;
    _blink.reset();
    if (animate) _schedule();
  }

  // NOTE: 2回目以降は周期ぴったりの Timer.periodic で始める。瞬きの終わり（completed）から
  // 次を数えると、終わりに気づくフレームの分だけ毎周期遅れていくため。
  void _schedule() {
    _hold = Timer(rapiBlinkCycle * rapiBlinkCloseStart, () {
      if (!mounted || !_animate) return;
      _blink.forward(from: 0);
      _hold = Timer.periodic(rapiBlinkCycle, (_) {
        if (mounted && _animate) _blink.forward(from: 0);
      });
    });
  }

  void _onBlinkStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) _blink.value = 0;
  }

  @override
  void dispose() {
    _hold?.cancel();
    _blink.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = widget.size;
    final height = size * RapiAvatar._svgAspect;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 0,
            top: 0,
            width: size,
            height: height,
            child: SvgPicture.asset(
              'assets/rapi_avatar.svg',
              width: size,
              height: height,
              semanticsLabel: 'ラピ',
            ),
          ),
          // NOTE: SVG では目の上に前側の環が重なる順だが、環（中心からの距離 17 以上）と
          // 目（中心から約 12、縦 ±5.8）は交わらないため、目を最後に描いても見た目は同じ。
          Positioned(
            left: 0,
            top: 0,
            width: size,
            height: height,
            child: IgnorePointer(
              child: CustomPaint(painter: RapiEyesPainter(phase: () => _phase, repaint: _blink)),
            ),
          ),
        ],
      ),
    );
  }
}

/// ラピの点の目（白い楕円2つ）を、周期内の位置に応じた縦の縮みで描く。
///
/// 位置・大きさはデスクトップの viewBox 120 座標（中心 (48,72)/(72,72)、rx 4.3、ry 5.8）を
/// 描画領域の幅に比例させたもの。縮みは各目の中心を軸にする。
class RapiEyesPainter extends CustomPainter {
  static const double _viewBox = 120;
  static const double _eyeY = 72;
  static const List<double> _eyeXs = [48, 72];
  static const double _eyeRx = 4.3;
  static const Color _eyeColor = Color(0xFFFFFFFF);

  /// 周期内の位置（0〜1）を返す。描くたびに読む。
  final double Function() phase;

  /// [phase] と [repaint] を受け取る。/ phase：周期内の位置を返す関数、repaint：描き直しの合図
  RapiEyesPainter({required this.phase, super.repaint});

  /// いまの ry の比率（開いた目 = 1）。テストと描画で同じ値を使う。
  double get ryRatio => rapiBlinkRyRatio(phase());

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / _viewBox;
    final paint = Paint()..color = _eyeColor;
    final ry = rapiEyeRy * ryRatio;
    for (final x in _eyeXs) {
      canvas.drawOval(
        Rect.fromCenter(center: Offset(x * scale, _eyeY * scale), width: _eyeRx * 2 * scale, height: ry * 2 * scale),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(RapiEyesPainter oldDelegate) => true;
}
