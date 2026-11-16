import 'package:flutter/material.dart';

import 'rapi_message_markdown.dart';
import 'rapi_typing_indicator.dart';

// ラピの会話の行：ユーザーの発言（受け取りスタンプ付き）、ラピの発言の白いカード、考え中の行。
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

/// 受け取りスタンプの直径
const double rapiStampSize = 21;

/// 受け取りスタンプの字（ラピがその発言を受け付けた印）
const String rapiStampGlyph = '👌';

/// ユーザーの発言：尻尾のない角丸の塊を右寄せ（藍色）。
/// [accepted] のときは、ラピが受け付けた印のスタンプを吹き出しの左下の角に重ねる。
class RapiUserMessage extends StatelessWidget {
  final String text;

  /// ラピがこの発言を受け付けたか（送信に失敗した発言・取り消した発言は false）
  final bool accepted;

  const RapiUserMessage({super.key, required this.text, this.accepted = false});

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
        // スタンプは吹き出しの外へ少しはみ出す。下にはみ出した分は次の行との間隔（14）に収まる
        child: accepted
            ? Stack(
                clipBehavior: Clip.none,
                children: [
                  bubble,
                  const Positioned(left: -7, bottom: -8, child: RapiReceivedStamp()),
                ],
              )
            : bubble,
      ),
    );
  }
}

/// 受け取りスタンプ：白い円（薄い枠と影）の中に 👌
class RapiReceivedStamp extends StatelessWidget {
  const RapiReceivedStamp({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'ラピが受け付けました',
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
        child: const ExcludeSemantics(
          child: Text(
            rapiStampGlyph,
            // NOTE: 字形は端末の絵文字フォントに任せる。名前を挙げるのは、端末側に無い名前は
            // 無視されるだけで、画面テストのキャプチャで読み込んだ絵文字フォントを使うため
            style: TextStyle(
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

/// ラピの発言：全幅の白いカードに本文（返答は Markdown で返るので、体裁を整えて描く）
class RapiReplyMessage extends StatelessWidget {
  final String text;

  const RapiReplyMessage({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    // NOTE: SelectableText のプレーン表示から Markdown へ替えた（記法が記号のまま見えていた）。
    // 選択は RapiMessageMarkdown の SelectionArea で続けてできる
    return RapiCard(child: RapiMessageMarkdown(data: text));
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
