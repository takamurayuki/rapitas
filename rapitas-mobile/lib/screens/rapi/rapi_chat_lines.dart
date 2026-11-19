import 'package:flutter/material.dart';

import '../../models/rapi_chat/rapi_read_mark.dart';
import 'rapi_message_markdown.dart';
import 'rapi_reply_copy_button.dart';
import 'rapi_typing_indicator.dart';

// ラピの会話の行：ユーザーの発言（確認済みのスタンプ付き）、ラピの発言の白いカード、考え中の行。
//
// NOTE: rapi_screen.dart（1,700行超）から移した。構造化カード（提案・整理・計画・伴走など）は
// ここには置かない（それぞれのファイルが持つ）。

/// ユーザーの発言の地色（藍色）
const Color rapiUserBubbleColor = Color(0xFF4F46E5);

/// ラピの発言の本文色（デスクトップ RapiAvatarDock.tsx の light 本文色）
const Color rapiChatText = Color(0xFF1F2937);

/// ラピの発言カードの地色と枠
const Color rapiCardBg = Color(0xFFFFFFFF);
const Color rapiCardBorder = Color(0xFFE4E4E7);

/// 確認済みスタンプの直径
const double rapiStampSize = 21;

// NOTE: 字は一律の 👌 から、発言の意図で決める字に替えた（rapiStampGlyphFor。nav63）

/// ユーザーの発言：尻尾のない角丸の塊を右寄せ（藍色）。
/// [readAs] があるとき（ラピが読み取った発言）は、その意図の字のスタンプを吹き出しの右下の角に重ねる。
class RapiUserMessage extends StatelessWidget {
  final String text;

  /// ラピがこの発言を確認したときの意図（null なら付けない：送信中・送信に失敗した発言）
  final String? readAs;

  const RapiUserMessage({super.key, required this.text, this.readAs});

  @override
  Widget build(BuildContext context) {
    final maxWidth = MediaQuery.sizeOf(context).width * 0.8;
    final bubble = Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: rapiUserBubbleColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: SelectableText(
        text,
        style: const TextStyle(fontSize: 15, height: 1.45, color: Colors.white),
      ),
    );
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        // スタンプは吹き出しの外へ少しはみ出す。下にはみ出した分は次の行との間隔（14）に、
        // 右にはみ出した分は一覧の左右の余白（16）に収まる
        // NOTE: 左下（会話の側）から右下へ移した（既読の印の位置。nav63 のフィードバック）
        child: readAs != null
            ? Stack(
                clipBehavior: Clip.none,
                children: [
                  bubble,
                  Positioned(right: -7, bottom: -8, child: RapiReadStamp(glyph: rapiStampGlyphFor(readAs))),
                ],
              )
            : bubble,
      ),
    );
  }
}

/// 確認済みスタンプ：白い円（薄い枠と影）の中に意図の字（🫡・👀・👌）
class RapiReadStamp extends StatelessWidget {
  /// スタンプの字（rapiStampGlyphFor で決める）
  final String glyph;

  const RapiReadStamp({super.key, required this.glyph});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'ラピが確認しました',
      child: Container(
        key: const ValueKey('rapi-received-stamp'),
        width: rapiStampSize,
        height: rapiStampSize,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: rapiCardBorder),
          boxShadow: const [
            BoxShadow(color: Color(0x1F000000), blurRadius: 4, offset: Offset(0, 1)),
          ],
        ),
        child: ExcludeSemantics(
          child: Text(
            glyph,
            // NOTE: 字形は端末の絵文字フォントに任せる。名前を挙げるのは、端末側に無い名前は
            // 無視されるだけで、画面テストのキャプチャで読み込んだ絵文字フォントを使うため
            style: const TextStyle(
              fontSize: 12,
              height: 1,
              fontFamilyFallback: ['Apple Color Emoji', 'Noto Color Emoji'],
            ),
          ),
        ),
      ),
    );
  }
}

/// ラピの発言を載せる白いカード（全幅・尻尾なし・アバターなし。左右の余白は一覧の 16）
class RapiCard extends StatelessWidget {
  final Widget child;

  /// 一覧の幅いっぱいに広げるか（false なら中身の幅。考え中の三点）
  final bool fullWidth;

  const RapiCard({super.key, required this.child, this.fullWidth = true});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: fullWidth ? double.infinity : null,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: rapiCardBg,
        border: Border.all(color: rapiCardBorder),
        borderRadius: BorderRadius.circular(16),
      ),
      child: child,
    );
  }
}

/// コピーのアイコンをカードの上と右の余白へどれだけ食い込ませるか
const double _copyLift = 12;

/// RapiCard の上と右の余白（RapiCard の padding と同じ値）
const double _cardPadTop = 14;
const double _cardPadRight = 16;

/// ラピの発言：全幅の白いカードに本文（返答は Markdown で返るので、体裁を整えて描く）。
/// 右上に原文のコピー（空の返答には付けない）、[footer] があれば本文の下に置く（「ノートに保存」）
class RapiReplyMessage extends StatelessWidget {
  final String text;
  final Widget? footer;

  const RapiReplyMessage({super.key, required this.text, this.footer});

  @override
  Widget build(BuildContext context) {
    // NOTE: SelectableText のプレーン表示から Markdown へ替えた（記法が記号のまま見えていた）。
    // 選択は RapiMessageMarkdown の SelectionArea で続けてできる
    final body = RapiMessageMarkdown(data: text);
    final extra = footer;
    final content = extra == null
        ? body
        : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [body, extra]);
    if (text.trim().isEmpty) return RapiCard(child: content);
    // NOTE: アイコンは本文に重ねず、本文を下へずらして上に場所を空ける（nav74）。
    // 右に空けると本文の幅と折り返しが変わるため、変わるのは高さだけにする
    // NOTE: Stack はカードの外側に置く。カードの内側だと、余白へはみ出たアイコンの部分に
    // タップが届かない（hit test は Stack の大きさの内側だけ）
    return Stack(
      fit: StackFit.passthrough,
      children: [
        RapiCard(
          child: Padding(
            padding: const EdgeInsets.only(top: rapiReplyCopyButtonSize - _copyLift),
            child: content,
          ),
        ),
        Positioned(
          top: _cardPadTop - _copyLift,
          right: _cardPadRight - _copyLift,
          child: RapiReplyCopyButton(text: text),
        ),
      ],
    );
  }
}

/// 送信中の行：ラピの発言と同じ白いカードに、波打つ三点だけを置く（文言は出さない）
class RapiThinkingRow extends StatelessWidget {
  /// 行の下に空ける間隔（一覧の発言どうしの間隔）
  final double gap;

  const RapiThinkingRow({super.key, required this.gap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: const ValueKey('rapi-typing'),
      padding: EdgeInsets.only(bottom: gap),
      // NOTE: 全幅にすると三点だけの横長の帯に見えるので、点に合わせた幅の吹き出しにする
      child: const Align(
        alignment: Alignment.centerLeft,
        child: RapiCard(fullWidth: false, child: RapiTypingDots()),
      ),
    );
  }
}
