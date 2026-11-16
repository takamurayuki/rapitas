import 'package:flutter/material.dart';

// ラピの会話の末尾ジャンプ：最下部から離れて読んでいるときだけ、一覧の右下に半透明の ▽ を浮かせる。
// あわせて「いま最下部付近にいるか」の判定もここに置く（新着で自動スクロールするかの判断に使う）。

/// 最下部からこれだけ離れたらジャンプボタンを出す（px）
const double rapiJumpThreshold = 200;

/// 最下部「付近」とみなす距離（px）。新着が来たとき、ここにいれば末尾へ寄せる
const double rapiFollowThreshold = 80;

/// 一覧の最下部までの残り（px）。
///
/// @param metrics - 一覧のスクロール位置 / スクロール位置
/// @returns 最下部までの距離（0以上） / 残りの距離
double rapiDistanceToEnd(ScrollMetrics metrics) =>
    (metrics.maxScrollExtent - metrics.pixels).clamp(0.0, double.infinity);

/// ジャンプボタンを出すか（最下部から [rapiJumpThreshold] 以上離れているか）。
///
/// @param metrics - 一覧のスクロール位置 / スクロール位置
/// @returns 出すなら true / 表示するか
bool rapiShowsJump(ScrollMetrics metrics) => rapiDistanceToEnd(metrics) >= rapiJumpThreshold;

/// 新着を自動で見せてよいか（最下部付近にいるか）。
///
/// @param metrics - 一覧のスクロール位置 / スクロール位置
/// @returns 最下部付近なら true / 追従してよいか
bool rapiFollowsNew(ScrollMetrics metrics) => rapiDistanceToEnd(metrics) <= rapiFollowThreshold;

/// 半透明の円形ボタン（▽）。押すと最下部へ滑らかにスクロールする（スクロールは呼び出し側）
class RapiJumpToLatestButton extends StatelessWidget {
  final VoidCallback onPressed;

  const RapiJumpToLatestButton({super.key, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: '最新の発言へ',
      child: Material(
        key: const ValueKey('rapi-jump-to-latest'),
        color: Colors.white.withValues(alpha: 0.72),
        shape: CircleBorder(side: BorderSide(color: const Color(0xFFD4D4D8).withValues(alpha: 0.9))),
        elevation: 2,
        shadowColor: const Color(0x33000000),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: const SizedBox.square(
            dimension: 40,
            child: Icon(Icons.keyboard_arrow_down, size: 26, color: Color(0xFF52525B)),
          ),
        ),
      ),
    );
  }
}
