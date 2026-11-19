import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';

// 返答のコピーの通知が、共有の ScaffoldMessenger の外からの操作に巻き込まれても壊れないこと。
// - ほかの画面（設定の接続操作）の clearSnackBars() でキュー待ちの通知が消されても、
//   以後のコピーで通知が出る（消された通知の closed は完了しない。Flutter 3.47）
// - クリップボードの処理がボタンやメッセンジャーの破棄後に返っても、例外を出さない

const _reply = 'まず **ログ** を見ます。';

final _copyButton = find.byTooltip('返答をコピー');

void main() {
  var failClipboard = false;
  Completer<void>? clipboardGate;

  setUp(() {
    failClipboard = false;
    clipboardGate = null;
  });

  void mockClipboard(WidgetTester tester) {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform,
        (call) async {
      if (call.method == 'Clipboard.setData') {
        final gate = clipboardGate;
        if (gate != null) await gate.future;
        if (failClipboard) throw PlatformException(code: 'denied');
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
  }

  /// 返答だけを置いた画面。[showReply] を false にするとボタンだけが外れる（メッセンジャーは残る）
  Future<ScaffoldMessengerState> pumpReply(WidgetTester tester, ValueNotifier<bool> showReply) async {
    mockClipboard(tester);
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(
        home: Scaffold(
          body: ValueListenableBuilder<bool>(
            valueListenable: showReply,
            builder: (context, show, _) =>
                show ? const RapiReplyMessage(text: _reply) : const SizedBox.shrink(),
          ),
        ),
      ),
    ));
    return tester.state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger));
  }

  /// 通知が尽きるまで刻んで進める（表示時間のタイマーは出終わった後のビルドで始まるため）
  Future<void> drain(WidgetTester tester) async {
    for (var i = 0; i < 120; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pumpAndSettle();
  }

  testWidgets('キュー待ちの通知が clearSnackBars() で消された後も、同じボタンのコピーで通知が出る',
      (tester) async {
    final messenger = await pumpReply(tester, ValueNotifier<bool>(true));
    messenger.showSnackBar(const SnackBar(content: Text('ノートに保存しました')));
    await tester.pumpAndSettle();

    // 保存の通知の後ろでコピーの通知が待っている間に、別の画面がキューを消し、自分の通知を出す
    await tester.tap(_copyButton);
    await tester.pump();
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(content: Text('見つかりました')));
    await drain(tester);
    expect(find.byType(SnackBar), findsNothing);

    // 失敗：通知が出る
    failClipboard = true;
    await tester.tap(_copyButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('コピーできませんでした'), findsOneWidget);
    await drain(tester);

    // 成功：通知が出る
    failClipboard = false;
    await tester.tap(_copyButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('コピーしました'), findsOneWidget);
    await drain(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets('別の画面の通知が出ている間にキューを消されても、その後のコピーの通知は順番どおり1件だけ出る',
      (tester) async {
    final messenger = await pumpReply(tester, ValueNotifier<bool>(true));
    messenger.showSnackBar(const SnackBar(content: Text('ノートに保存しました')));
    await tester.pumpAndSettle();
    await tester.tap(_copyButton);
    await tester.pump();
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(content: Text('見つかりました')));
    // 1フレーム目で保存の通知の退場が始まり、次のフレームで「見つかりました」が出始める
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('見つかりました'), findsOneWidget);

    // 「見つかりました」が出ている間に失敗する。その通知は打ち切らず、後に1件だけ出る
    failClipboard = true;
    await tester.tap(_copyButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('見つかりました'), findsOneWidget);
    var failureShown = false;
    for (var i = 0; i < 120; i++) {
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('コピーしました'), findsNothing, reason: '${i * 100}ms');
      expect(find.text('コピーできませんでした').evaluate().length, lessThanOrEqualTo(1));
      if (find.text('コピーできませんでした').evaluate().isNotEmpty) failureShown = true;
    }
    expect(failureShown, isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('クリップボードの処理がボタンを外した後に失敗で返っても、例外を出さず通知も出さない',
      (tester) async {
    final showReply = ValueNotifier<bool>(true);
    await pumpReply(tester, showReply);
    failClipboard = true;
    clipboardGate = Completer<void>();

    await tester.tap(_copyButton);
    await tester.pump();
    showReply.value = false;
    await tester.pump();
    expect(_copyButton, findsNothing);

    clipboardGate!.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('クリップボードの処理がメッセンジャーの破棄後に失敗で返っても、例外を出さない', (tester) async {
    await pumpReply(tester, ValueNotifier<bool>(true));
    failClipboard = true;
    clipboardGate = Completer<void>();

    await tester.tap(_copyButton);
    await tester.pump();
    // 画面ごと外す（ScaffoldMessenger も破棄される）
    await tester.pumpWidget(const SizedBox.shrink());

    clipboardGate!.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
  });
}
