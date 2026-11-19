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
  _CopyNotice? _notice;

  @override
  void dispose() {
    _reset?.cancel();
    // NOTE: 出した通知はメッセンジャー側の持ち物なので閉じない（画面を離れても順番どおり出て消える）。
    // 参照を手放すだけにして、破棄済みの文脈から ScaffoldMessenger を触らない
    _notice = null;
    super.dispose();
  }

  /// 自分が出した通知だけを [message] に差し替える。ほかの発行元（ノート保存など）の通知は閉じない。
  ///
  /// NOTE: showSnackBar が返す controller の close() は、キューで待っている通知には使えない
  /// （Flutter 3.47 の scaffold.dart は `assert(_snackBars.first == controller)` のうえで
  /// hideCurrentSnackBar() を呼ぶので、リリースでは先頭にいる他人の通知を閉じてしまう）。
  /// そこで、自分の通知が「いま画面に出ている」ときだけ close() し、キューで待っているときは
  /// その通知の文言を最新に書き換える。待っている通知は表示が始まってから時間を数えるので、
  /// 書き換えた文言も表示時間を丸ごと使える。
  void _notify(ScaffoldMessengerState? messenger, String message) {
    if (messenger == null) return;
    final notice = _notice;
    if (notice != null && !notice.closed && !notice.onScreen) {
      notice.message.value = message;
      return;
    }
    if (notice != null && !notice.closed) {
      // 画面に出ている＝先頭にいるので、close() は自分の通知を閉じる
      notice.controller?.close();
    }
    final next = _CopyNotice(message);
    next.controller = messenger.showSnackBar(SnackBar(
      content: _CopyNoticeText(notice: next),
      // 失敗は読み落とさないよう SnackBar の既定（4秒）のまま。成功は2秒
      duration: message == rapiReplyCopiedMessage
          ? rapiReplyCopiedDuration
          : const Duration(milliseconds: 4000),
    ));
    next.controller!.closed.whenComplete(() => next.closed = true);
    _notice = next;
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
      _notify(messenger, rapiReplyCopyFailedMessage);
      return;
    }
    if (!mounted) return;
    setState(() => _copied = true);
    _notify(messenger, rapiReplyCopiedMessage);
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

/// コピーのボタンが出した通知1件。文言は表示が始まるまで差し替えられる。
class _CopyNotice {
  _CopyNotice(String initial) : message = ValueNotifier<String>(initial);

  // NOTE: dispose しない。キューで待つ通知が後から組み立てられるときにも読むため、
  // 寿命は通知の側に合わせて GC に任せる（リスナーは _CopyNoticeText が外す）
  final ValueNotifier<String> message;
  ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? controller;
  bool closed = false;

  /// Scaffold が組み立てるのは先頭の通知だけなので、文言が組み立て済み＝画面に出ている
  /// （同じメッセンジャーの下に Scaffold が複数あると、それぞれが組み立てるので数で持つ）
  int builtCount = 0;

  bool get onScreen => builtCount > 0;
}

class _CopyNoticeText extends StatefulWidget {
  final _CopyNotice notice;

  const _CopyNoticeText({required this.notice});

  @override
  State<_CopyNoticeText> createState() => _CopyNoticeTextState();
}

class _CopyNoticeTextState extends State<_CopyNoticeText> {
  @override
  void initState() {
    super.initState();
    widget.notice.builtCount++;
  }

  @override
  void dispose() {
    widget.notice.builtCount--;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: widget.notice.message,
      builder: (context, message, _) => Text(message),
    );
  }
}
