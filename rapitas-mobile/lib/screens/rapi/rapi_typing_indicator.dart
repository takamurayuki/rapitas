import 'dart:async';

import 'package:flutter/widgets.dart';

// ラピの「考え中」：白いカードの中で三つの点が位相をずらして上下に波打つ（文言は出さない）。
//
// NOTE: AnimationController.repeat() や AnimatedContainer などの暗黙アニメーションは使わない。
// 終わらないアニメーションはフレームを予約し続け、送信中に pumpAndSettle を呼ぶ画面テストが
// 終わらなくなる（rapi_avatar.dart の瞬きと同じ理由）。タイマーで位相を1コマずつ進め、
// 各コマは静止画として描く。

/// 1コマの長さ（10コマで1周＝1.2秒）
const Duration rapiTypingStep = Duration(milliseconds: 120);

/// 1周のコマ数
const int rapiTypingSteps = 10;

/// 隣の点との位相のずれ（コマ数）
const int rapiTypingDotLag = 2;

/// 点の直径
const double rapiTypingDotSize = 7.5;

/// 点どうしの間隔
const double rapiTypingDotGap = 4;

/// いちばん上がったときの持ち上がり（px）。小さく波打たせる
const double rapiTypingMaxLift = 3.5;

/// コマごとの持ち上がりの比率（0〜1）。前半で上がって下り、後半は休む
const List<double> _liftCurve = [0, 0.55, 1, 0.55, 0.15, 0, 0, 0, 0, 0];

const Color _restColor = Color(0xFFA1A1AA);
const Color _liftColor = Color(0xFF8B5CF6);

/// 周期内のコマ [tick] で、[dot] 番目（0始まり）の点がどれだけ上がっているか（0〜1）。
///
/// @param tick - 進んだコマ数 / 経過コマ数
/// @param dot - 点の番号（左から0,1,2） / 点の位置
/// @returns 持ち上がりの比率 / 0〜1 の比率
double rapiTypingLift(int tick, int dot) {
  final local = (tick - dot * rapiTypingDotLag) % rapiTypingSteps;
  return _liftCurve[local < 0 ? local + rapiTypingSteps : local];
}

/// 波打つ三点。MediaQuery.disableAnimations のときは並べるだけで動かさない。
class RapiTypingDots extends StatefulWidget {
  const RapiTypingDots({super.key});

  @override
  State<RapiTypingDots> createState() => _RapiTypingDotsState();
}

class _RapiTypingDotsState extends State<RapiTypingDots> {
  Timer? _timer;
  int _tick = 0;
  bool _animate = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animate = !(MediaQuery.maybeDisableAnimationsOf(context) ?? false);
    if (animate == _animate) return;
    _animate = animate;
    _timer?.cancel();
    _timer = null;
    if (!animate) {
      _tick = 0;
      return;
    }
    _timer = Timer.periodic(rapiTypingStep, (_) {
      if (mounted) setState(() => _tick = (_tick + 1) % rapiTypingSteps);
    });
  }

  @override
  void dispose() {
    // 送信が終わって行が消えたら必ず止める（残ったタイマーはテストでも失敗になる）
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'ラピが考えています',
      child: SizedBox(
        // 上がった点が切れないよう、持ち上がりの分だけ上に余白を取る
        height: rapiTypingDotSize + rapiTypingMaxLift,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: rapiTypingDotGap),
              _dot(i, _animate ? rapiTypingLift(_tick, i) : 0),
            ],
          ],
        ),
      ),
    );
  }

  Widget _dot(int i, double lift) {
    return Transform.translate(
      key: ValueKey('rapi-typing-dot-$i'),
      offset: Offset(0, -rapiTypingMaxLift * lift),
      child: Container(
        width: rapiTypingDotSize,
        height: rapiTypingDotSize,
        decoration: BoxDecoration(
          color: Color.lerp(_restColor, _liftColor, lift),
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}
