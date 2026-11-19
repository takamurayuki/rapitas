import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// ラピの文章の返答カードの右上に置く、小さなコピーのアイコン（nav74）。
// 押すと返答の Markdown の原文をクリップボードへ入れる（表示用に整えた文字列ではない。
// ノート等へ貼ったときに書式を保つため）。

/// コピーできたときの文言
const String rapiReplyCopiedMessage = 'コピーしました';

/// クリップボードへ書けなかったときの文言
const String rapiReplyCopyFailedMessage = 'コピーできませんでした';

/// アイコンの押せる範囲の一辺
const double rapiReplyCopyButtonSize = 28;

/// コピー後にチェックを見せておく時間
const Duration rapiReplyCopiedDuration = Duration(seconds: 2);

const Color _muted = Color(0xFF6B7280);
const Color _copiedColor = Color(0xFF059669);

/// 返答 [text] をコピーするアイコンボタン。成功したらスナックバーとチェックで知らせ、
/// 失敗したら失敗の文言だけを出す（チェックにはしない）。
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
    super.dispose();
  }

  Future<void> _copy() async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await Clipboard.setData(ClipboardData(text: widget.text));
    } catch (_) {
      // 直前の成功から2秒以内の失敗でも、チェックと「コピーしました」を残さない
      _reset?.cancel();
      _reset = null;
      if (mounted && _copied) setState(() => _copied = false);
      messenger
        ?..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text(rapiReplyCopyFailedMessage)));
      return;
    }
    if (!mounted) return;
    setState(() => _copied = true);
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(
        content: Text(rapiReplyCopiedMessage),
        duration: Duration(seconds: 2),
      ));
    _reset?.cancel();
    _reset = Timer(rapiReplyCopiedDuration, () {
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
