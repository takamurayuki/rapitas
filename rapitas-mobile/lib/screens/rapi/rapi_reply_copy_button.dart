import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// ラピの文章の返答カードの右上に置く、小さなコピーのアイコン（nav74）。
// 押すと返答の Markdown の原文をクリップボードへ入れる（表示用に整えた文字列ではない。
// ノート等へ貼ったときに書式を保つため）。
//
// NOTE: 知らせ方はアイコンの変化だけ（本人の設計変更、2026-11-19）。SnackBar は使わない。
// 共有の ScaffoldMessenger のキューに入れると、ほかの発行元の通知との順番や打ち切りを
// 制御しきれなかったため（直し回1〜3）。通知を足し直すとその問題が戻る。

/// アイコンの押せる範囲の一辺
const double rapiReplyCopyButtonSize = 28;

/// コピー後にチェックを見せておく時間
const Duration rapiReplyCopiedDuration = Duration(seconds: 2);

const Color _muted = Color(0xFF6B7280);
const Color _copiedColor = Color(0xFF059669);

/// 返答 [text] をコピーするアイコンボタン。成功したら [rapiReplyCopiedDuration] の間だけ
/// チェックに変わる。失敗したらチェックにしない（直前の成功のチェックも外す）。
class RapiReplyCopyButton extends StatefulWidget {
  /// コピーする返答（Markdown の原文）
  final String text;

  const RapiReplyCopyButton({super.key, required this.text});

  @override
  State<RapiReplyCopyButton> createState() => _RapiReplyCopyButtonState();
}

class _RapiReplyCopyButtonState extends State<RapiReplyCopyButton> {
  bool _copied = false;
  Timer? _reset;

  @override
  void dispose() {
    _reset?.cancel();
    _reset = null;
    super.dispose();
  }

  Future<void> _copy() async {
    var ok = true;
    try {
      await Clipboard.setData(ClipboardData(text: widget.text));
    } catch (_) {
      ok = false;
    }
    // クリップボードの処理が画面の破棄後に返った場合は、状態もタイマーも触らない
    if (!mounted) return;
    _reset?.cancel();
    _reset = null;
    if (!ok) {
      // 直前の成功から2秒以内の失敗でも、チェックを残して成功と見せない
      if (_copied) setState(() => _copied = false);
      return;
    }
    setState(() => _copied = true);
    _reset = Timer(rapiReplyCopiedDuration, () {
      _reset = null;
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: rapiReplyCopyButtonSize,
      child: IconButton(
        key: const ValueKey('rapi-copy-reply'),
        tooltip: '返答をコピー',
        onPressed: _copy,
        padding: EdgeInsets.zero,
        iconSize: 16,
        color: _copied ? _copiedColor : _muted,
        style: IconButton.styleFrom(tapTargetSize: MaterialTapTargetSize.shrinkWrap),
        constraints: const BoxConstraints.tightFor(
            width: rapiReplyCopyButtonSize, height: rapiReplyCopyButtonSize),
        icon: Icon(_copied ? Icons.check : Icons.copy_rounded),
      ),
    );
  }
}
