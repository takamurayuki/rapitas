import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// ラピ本人（デスクトップ RapiAvatar.tsx の idle・light を静止画にしたもの）。
///
/// [size] はデスクトップと同じく本体の箱（viewBox 120×120）の大きさで、
/// レイアウト上もこの正方形を占める。足元の影はデスクトップ同様この箱の下に
/// はみ出して描かれる（SVG は影の分だけ縦に 134 まで伸ばしてある）。
class RapiAvatar extends StatelessWidget {
  /// SVG の高さ / 本体の箱の高さ（assets/rapi_avatar.svg の viewBox 120×134）
  static const double _svgAspect = 134 / 120;

  final double size;

  const RapiAvatar({super.key, required this.size});

  @override
  Widget build(BuildContext context) {
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
            height: size * _svgAspect,
            child: SvgPicture.asset(
              'assets/rapi_avatar.svg',
              width: size,
              height: size * _svgAspect,
              semanticsLabel: 'ラピ',
            ),
          ),
        ],
      ),
    );
  }
}
