import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

// 聞き取り表示の形（「・・・」・波形・回転する輪・「？」・一時停止の2本棒・斜線入りの「・・・」）。
// どれも見た目 30×30 の枠の中に収まる大きさで描く（枠と色・状態の対応は voice_mode_indicator.dart）。
// 見本は nav25/ui-preview/indicator-mock-v2.html（2026-11-11 本人決定）。

/// 横に並んだ3つの点（話せます・準備中・使えない の土台）
class VoiceDotsGlyph extends StatelessWidget {
  final Color color;

  const VoiceDotsGlyph({super.key, required this.color});

  /// 点の直径・間隔（見本どおり 6px・4px）
  static const double dot = 6;
  static const double gap = 4;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) const SizedBox(width: gap),
          Container(
            width: dot,
            height: dot,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
        ],
      ],
    );
  }
}

/// 使えない：グレーの「・・・」に斜線（見本どおり左下から右上へ）
class VoiceSlashedDotsGlyph extends StatelessWidget {
  final Color dotColor;
  final Color lineColor;

  const VoiceSlashedDotsGlyph({super.key, required this.dotColor, required this.lineColor});

  @override
  Widget build(BuildContext context) {
    // 「・・・」の幅（26）より少し広く取り、斜線が点の両端にかかるようにする
    return SizedBox.square(
      dimension: 28,
      child: CustomPaint(
        foregroundPainter: _SlashPainter(lineColor),
        child: Center(child: VoiceDotsGlyph(color: dotColor)),
      ),
    );
  }
}

class _SlashPainter extends CustomPainter {
  final Color color;

  const _SlashPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..color = color;
    final d = size.shortestSide * 0.12;
    canvas.drawLine(Offset(d, size.height - d), Offset(size.width - d, d), paint);
  }

  @override
  bool shouldRepaint(_SlashPainter old) => old.color != color;
}

/// 一時停止：縦2本の棒
class VoicePauseGlyph extends StatelessWidget {
  final Color color;

  const VoicePauseGlyph({super.key, required this.color});

  @override
  Widget build(BuildContext context) {
    Widget bar() => Container(
          width: 5,
          height: 16,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        );
    return Row(mainAxisSize: MainAxisSize.min, children: [bar(), const SizedBox(width: 4), bar()]);
  }
}

/// 回答待ち：オレンジの丸に「？」
class VoiceQuestionGlyph extends StatelessWidget {
  final Color color;

  const VoiceQuestionGlyph({super.key, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 26,
      height: 26,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: const Text(
        '?',
        textScaler: TextScaler.noScaling, // 大きい文字設定でも丸からはみ出さない
        style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, height: 1),
      ),
    );
  }
}

/// 処理中：3/4 周の輪が回る
class VoiceSpinPainter extends CustomPainter {
  final Animation<double> t;
  final Color color;

  VoiceSpinPainter(this.t, this.color) : super(repaint: t);

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
  bool shouldRepaint(VoiceSpinPainter old) => old.color != color;
}

/// 声を受け取り中：緑の縦棒5本の波形。
/// [level]（0〜1）が届く端末では音量に合わせて高さが変わる。届かない端末（null）では一定のゆらぎで動かす。
class VoiceWavePainter extends CustomPainter {
  final Animation<double> t;
  final ValueListenable<double?>? level;
  final Color color;

  VoiceWavePainter(this.t, this.level, this.color)
      : super(repaint: level == null ? t : Listenable.merge([t, level]));

  /// 棒の数・太さ・間隔（見本どおり 4px・3px）
  static const int bars = 5;
  static const double barWidth = 4;
  static const double barGap = 3;

  /// 一番高い棒の高さ
  static const double maxHeight = 24;
  static const double minHeight = 4;

  /// 棒ごとの基本の高さ（見本の 8・16・22・13・19 を最大 22 で割ったもの）
  static const List<double> _shape = [0.36, 0.73, 1.0, 0.59, 0.86];

  /// 棒 [i] の高さ（描画とテストの両方で使う）
  ///
  /// @param i - 棒の番号（0 始まり） / 棒の番号
  /// @param phase - 動きの位置（0〜1） / アニメーションの位置
  /// @param level - 音量（0〜1）。null なら音量なしの一定のゆらぎ / 音量
  /// @returns 棒の高さ（px） / 棒の高さ
  static double barHeight(int i, double phase, double? level) {
    final wobble = math.sin(2 * math.pi * (phase + i * 0.17));
    final double amp;
    if (level == null) {
      amp = 0.6 + 0.3 * wobble;
    } else {
      // 小さな音でも棒が消えないよう下限を残し、音量に比例して伸ばす（わずかなゆらぎで生きている感じを残す）
      amp = (0.18 + 0.82 * level) * (1 + 0.08 * wobble);
    }
    return (maxHeight * _shape[i] * amp).clamp(minHeight, maxHeight);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    const total = bars * barWidth + (bars - 1) * barGap;
    var x = (size.width - total) / 2;
    final v = level?.value;
    for (var i = 0; i < bars; i++) {
      final h = barHeight(i, t.value, v);
      final rect = Rect.fromLTWH(x, (size.height - h) / 2, barWidth, h);
      canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(2)), paint);
      x += barWidth + barGap;
    }
  }

  @override
  bool shouldRepaint(VoiceWavePainter old) => old.color != color || old.level != level;
}
