import 'package:flutter/material.dart';
import '../utils/color_utils.dart';

/// 色ドット（色がパースできなければグレー）
class ColorDot extends StatelessWidget {
  final String? color;
  final double size;

  const ColorDot({super.key, required this.color, this.size = 12});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: ColorUtils.parseColor(color) ?? Colors.grey,
        shape: BoxShape.circle,
      ),
    );
  }
}
