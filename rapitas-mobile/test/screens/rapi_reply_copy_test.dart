import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_message_markdown.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// ラピの文章の返答カード右上のコピー：押すと Markdown の原文がクリップボードへ入り、
// アイコンがしばらくチェックに変わるだけで知らせる（通知は出さない）。失敗はチェックにしない。
// 利用者の発言には付けない。付けても本文の幅（折り返し）は変わらない。
// アイコンの変化の細かい場合分けは rapi_reply_copy_icon_test.dart。

const _reply = 'まず **ログ** を見ます。\n\n- `401` を探す';

class _Assistant implements AssistantService {
  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent();

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: _reply);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _copyButton = find.byTooltip('返答をコピー');

void main() {
  String? copied;
  var failClipboard = false;

  setUp(() {
    copied = null;
    failClipboard = false;
  });

  void mockClipboard(WidgetTester tester) {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform,
        (call) async {
      if (call.method == 'Clipboard.setData') {
        if (failClipboard) throw PlatformException(code: 'denied');
        copied = (call.arguments as Map)['text'] as String?;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
  }

  Future<void> pumpAndAsk(WidgetTester tester) async {
    mockClipboard(tester);
    await tester.pumpWidget(ProviderScope(
      overrides: [assistantServiceProvider.overrideWithValue(_Assistant())],
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'ログの見方は？');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  Finder replyCopyButton() => find.descendant(
        of: find.ancestor(of: find.textContaining('ログ', findRichText: true), matching: find.byType(RapiReplyMessage)),
        matching: _copyButton,
      );

  Finder iconIn(IconData icon) => find.descendant(of: replyCopyButton(), matching: find.byIcon(icon));

  testWidgets('コピーを押すと原文の Markdown が入り、通知は出さずにアイコンがチェックに変わる', (tester) async {
    await pumpAndAsk(tester);

    expect(replyCopyButton(), findsOneWidget);
    await tester.tap(replyCopyButton());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(copied, _reply);
    expect(iconIn(Icons.check), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
    expect(find.text('コピーしました'), findsNothing);

    // しばらくすると元のアイコンへ戻る
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(iconIn(Icons.copy_rounded), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('クリップボードへ書けなかったら、チェックにせず通知も出さない', (tester) async {
    await pumpAndAsk(tester);
    failClipboard = true;

    await tester.tap(replyCopyButton());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(copied, isNull);
    expect(iconIn(Icons.check), findsNothing);
    expect(iconIn(Icons.copy_rounded), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
    expect(find.text('コピーできませんでした'), findsNothing);
    await tester.pumpAndSettle();
  });

  testWidgets('利用者の発言にはコピーを付けない', (tester) async {
    await pumpAndAsk(tester);

    expect(find.descendant(of: find.byType(RapiUserMessage), matching: _copyButton), findsNothing);
  });

  testWidgets('コピーを付けても本文の幅は変わらない', (tester) async {
    Future<double> bodyWidth(String text) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: RapiReplyMessage(text: text),
          ),
        ),
      ));
      return tester.getSize(find.byType(RapiMessageMarkdown)).width;
    }

    // 空の返答にはコピーを付けない（比べる基準）
    final plain = await bodyWidth('');
    expect(_copyButton, findsNothing);
    final withCopy = await bodyWidth(_reply);
    expect(_copyButton, findsOneWidget);
    expect(withCopy, plain);
  });
}
