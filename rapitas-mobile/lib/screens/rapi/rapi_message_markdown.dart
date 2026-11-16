import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';

import '../../widgets/markdown/task_description_markdown.dart';

// ラピの発言（プレーンな会話の返答）を Markdown として白いカードの中に描く。
// 返答は Markdown で返るので、記号のまま出さず、見出し・箇条書き・太字・コード・表・引用・リンクを整える。
// 構造化カード（提案・整理・計画・伴走など）はここでは扱わない。
//
// NOTE: 色はチャットの白いカード前提（ダークテーマでもカードは白のまま。nav62 ブリーフィングの制約）。
// NOTE: リンクの扱いはタスク説明・ノートの前例（task_description_markdown.dart）に合わせる：
// http / https / mailto だけを外部で開き、開けなければ SnackBar で知らせる。

const Color _text = Color(0xFF1F2937);
const Color _muted = Color(0xFF52525B);
const Color _link = Color(0xFF7C3AED);
const Color _codeBg = Color(0xFFF4F4F5);
const Color _line = Color(0xFFE4E4E7);
const Color _quoteBar = Color(0xFFDDD6FE);

/// 本文の文字設定（現行のラピの発言と同じ 15px・行間 1.6）
const TextStyle rapiMarkdownBody = TextStyle(fontSize: 15, height: 1.6, color: _text);

/// ラピの発言用の Markdown のスタイル。見出しは控えめ（本文より少し大きい太字）にする。
///
/// @param theme - 現在のアプリテーマ（フォントの継承用） / アプリのテーマ
/// @returns ラピの発言カード用のスタイル / スタイルシート
MarkdownStyleSheet buildRapiMarkdownStyleSheet(ThemeData theme) {
  const body = rapiMarkdownBody;
  const mono = TextStyle(fontFamily: 'monospace', fontSize: 13.5, height: 1.5, color: _text);
  return MarkdownStyleSheet.fromTheme(theme).copyWith(
    p: body,
    a: body.copyWith(color: _link, decoration: TextDecoration.underline, decorationColor: _link),
    strong: const TextStyle(fontWeight: FontWeight.w700),
    em: const TextStyle(fontStyle: FontStyle.italic),
    del: const TextStyle(decoration: TextDecoration.lineThrough),
    h1: body.copyWith(fontSize: 19, height: 1.4, fontWeight: FontWeight.w700),
    h2: body.copyWith(fontSize: 17, height: 1.4, fontWeight: FontWeight.w700),
    h3: body.copyWith(fontSize: 15.5, height: 1.45, fontWeight: FontWeight.w700),
    h4: body.copyWith(fontWeight: FontWeight.w700),
    h5: body.copyWith(fontWeight: FontWeight.w700),
    h6: body.copyWith(fontWeight: FontWeight.w700, color: _muted),
    h1Padding: const EdgeInsets.only(top: 4),
    h2Padding: const EdgeInsets.only(top: 4),
    h3Padding: const EdgeInsets.only(top: 2),
    blockSpacing: 8,
    listBullet: body.copyWith(color: _muted),
    listIndent: 22,
    listBulletPadding: const EdgeInsets.only(right: 6),
    // インラインコードは _InlineCodeBuilder がチップにする。ここはコードブロックの文字
    code: mono,
    codeblockPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    codeblockDecoration: BoxDecoration(
      color: _codeBg,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: _line),
    ),
    blockquote: body.copyWith(color: _muted),
    blockquotePadding: const EdgeInsets.fromLTRB(10, 4, 8, 4),
    blockquoteDecoration: const BoxDecoration(
      border: Border(left: BorderSide(color: _quoteBar, width: 3)),
    ),
    checkbox: body.copyWith(color: _link),
    tableHead: body.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
    tableBody: body.copyWith(fontSize: 14, height: 1.45),
    tableBorder: TableBorder.all(color: _line),
    tableHeadAlign: TextAlign.start,
    tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
    tableCellsDecoration: const BoxDecoration(color: Colors.white),
    horizontalRuleDecoration: const BoxDecoration(border: Border(top: BorderSide(color: _line))),
  );
}

/// ラピの発言の本文（Markdown）。長押しで選択できる（SelectionArea）。
class RapiMessageMarkdown extends StatelessWidget {
  /// Markdown の本文
  final String data;

  /// リンクを開く（テストで差し替える）。既定は外部ブラウザ
  final MarkdownLinkLauncher? launcher;

  const RapiMessageMarkdown({super.key, required this.data, this.launcher});

  @override
  Widget build(BuildContext context) {
    // NOTE: MarkdownBody の selectable は使わない。段落ごとの SelectableText になり、インラインコードの
    // チップ（WidgetSpan）と両立しない。SelectionArea で包めば段落をまたいで選べ、リンクのタップも効く
    return SelectionArea(
      child: MarkdownBody(
        data: data,
        // 一覧（ListView）の中で伸びる。自分ではスクロールしない
        shrinkWrap: true,
        // コードブロック・引用の地色をカードの幅いっぱいに敷く
        fitContent: false,
        // 返答の改行1つは改行のまま見せる（これまでのプレーン表示と同じ）
        softLineBreak: true,
        styleSheet: buildRapiMarkdownStyleSheet(Theme.of(context)),
        builders: {'code': _InlineCodeBuilder()},
        onTapLink: (text, href, title) => _openLink(context, href),
      ),
    );
  }

  Future<void> _openLink(BuildContext context, String? href) async {
    final uri = parseLaunchableLink(href);
    var opened = false;
    if (uri != null) {
      try {
        opened = await (launcher ?? _launchExternally)(uri);
      } catch (_) {
        opened = false;
      }
    }
    // 開くのを待つ間に画面を離れていたら、次の画面に案内を出さない
    if (opened || !context.mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text('リンクを開けませんでした: ${href ?? ''}')),
    );
  }
}

Future<bool> _launchExternally(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// インラインコード（`code`）を角丸のチップにする。コードブロックの中の code は既定の描画に任せる
class _InlineCodeBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final code = element.textContent;
    // NOTE: コードブロック（pre > code）の本文は改行で終わり、言語名の class を持つことがある。
    // インラインコードは改行を含まない（CommonMark が空白に置き換える）ので、それで見分ける
    if (code.contains('\n') || element.attributes.containsKey('class')) return null;
    return Text.rich(
      WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: Container(
          key: const ValueKey('rapi-inline-code'),
          margin: const EdgeInsets.symmetric(horizontal: 1),
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          decoration: BoxDecoration(
            color: _codeBg,
            borderRadius: BorderRadius.circular(5),
            border: Border.all(color: _line),
          ),
          child: Text(
            code,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13.5,
              height: 1.3,
              color: Color(0xFF6D28D9),
            ),
          ),
        ),
      ),
    );
  }
}
