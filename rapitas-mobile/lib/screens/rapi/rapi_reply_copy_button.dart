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
  _CopyNoticeGroup? _group;

  @override
  void dispose() {
    _reset?.cancel();
    // NOTE: 出した通知はメッセンジャー側の持ち物なので閉じない（画面を離れても順番どおり出て消える）。
    // 参照を手放すだけにして、破棄済みの文脈から ScaffoldMessenger を触らない
    _group = null;
    super.dispose();
  }

  /// 自分が出した通知だけを [message] に差し替える。ほかの発行元（ノート保存など）の通知は閉じない。
  ///
  /// NOTE: showSnackBar が返す controller の close() は、キューで待っている通知には使えない
  /// （Flutter 3.47 の scaffold.dart は `assert(_snackBars.first == controller)` のうえで
  /// hideCurrentSnackBar() を呼ぶので、リリースでは先頭にいる他人の通知を閉じてしまう）。
  /// そこで、自分の通知が「いま画面に出ている」ときだけ close() し、まだ画面に出ていない
  /// 通知は文言を最新に書き換える。
  ///
  /// NOTE: 画面に出ていない通知は「キューで待っている」とは限らない。ほかの画面が
  /// clearSnackBars() を呼ぶとキューから外され、その closed は完了しない（Flutter 3.47 の
  /// scaffold.dart:463）。外されたかどうかは公開 API から判別できないので、書き換えに加えて
  /// 同じ組の予備の通知を1件出す。キューは先着順なので、待っている通知が残っていれば
  /// 必ずそちらが先に組み立てられて文言を見せ、予備は先頭に来た時点で何も見せずに退く。
  /// 外されていた場合は予備が文言を見せる。どちらでも最新の文言が1件だけ見える。
  void _notify(ScaffoldMessengerState? messenger, String message) {
    // 破棄後（クリップボードの処理が後から返った場合など）は何も出さない。
    // 破棄済みのメッセンジャーや Scaffold の無いメッセンジャーへの showSnackBar は assert で落ちる
    if (!mounted || messenger == null || !messenger.mounted) return;
    var group = _group;
    if (group != null) {
      final shown = group.shown;
      if (shown == null) {
        group.message.value = message;
      } else {
        // 画面に出ている＝先頭にいるので、close() は自分の通知を閉じる
        if (!shown.closed && shown.onScreen) shown.controller?.close();
        group = null;
      }
    }
    group ??= _group = _CopyNoticeGroup(message);
    final next = _CopyNotice(group);
    next.controller = messenger.showSnackBar(SnackBar(
      content: _CopyNoticeText(notice: next),
      // 失敗は読み落とさないよう SnackBar の既定（4秒）のまま。成功は2秒
      duration: message == rapiReplyCopiedMessage
          ? rapiReplyCopiedDuration
          : const Duration(milliseconds: 4000),
    ));
    next.controller!.closed.whenComplete(() => next.closed = true);
  }

  Future<void> _copy() async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await Clipboard.setData(ClipboardData(text: widget.text));
    } catch (_) {
      // 直前の成功から2秒以内の失敗でも、チェックと「コピーしました」を残さない
      _reset?.cancel();
      _reset = null;
      // 破棄後に失敗で返った場合は、チェックも通知も触らない
      if (!mounted) return;
      if (_copied) setState(() => _copied = false);
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

/// 同じ文言を見せるための通知の組。最初に画面に出た1件だけが文言を見せる。
class _CopyNoticeGroup {
  _CopyNoticeGroup(String initial) : message = ValueNotifier<String>(initial);

  // NOTE: dispose しない。キューで待つ通知が後から組み立てられるときにも読むため、
  // 寿命は通知の側に合わせて GC に任せる（リスナーは ValueListenableBuilder が外す）
  final ValueNotifier<String> message;

  /// 組の中で最初に画面に出た通知。まだ誰も出ていなければ null
  _CopyNotice? shown;
}

/// コピーのボタンが出した通知1件。
class _CopyNotice {
  _CopyNotice(this.group);

  final _CopyNoticeGroup group;
  ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? controller;
  bool closed = false;

  /// 退く処理を一度だけ予約するための印
  bool retreating = false;

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
    final notice = widget.notice;
    notice.builtCount++;
    notice.group.shown ??= notice;
    if (notice.group.shown != notice && !notice.retreating) {
      notice.retreating = true;
      // 同じ組のほかの通知が先に文言を見せたので、この予備は退く。組み立て中はメッセンジャーの
      // 状態を変えられないので、フレームの後で外す。先頭に来て組み立てられた通知なので、
      // removeCurrentSnackBar() は自分を外す（他人の通知は外さない）。退場の動きは付けない。
      // initState では InheritedWidget に依存できないので、祖先の State を直接たどる
      final messenger = context.findAncestorStateOfType<ScaffoldMessengerState>();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (notice.closed || messenger == null || !messenger.mounted) return;
        messenger.removeCurrentSnackBar();
      });
    }
  }

  @override
  void dispose() {
    widget.notice.builtCount--;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final notice = widget.notice;
    // 予備の通知は退くまでの1フレームも文言を見せない
    if (notice.group.shown != notice) return const SizedBox.shrink();
    return ValueListenableBuilder<String>(
      valueListenable: notice.group.message,
      builder: (context, message, _) => Text(message),
    );
  }
}
