import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';

// 返答のコピーは通知を出さず、アイコンの変化だけで知らせる（本人の設計変更、2026-11-19）。
// - 成功：チェックに変わり、2秒で元のコピーのアイコンへ戻る
// - 失敗：チェックにしない（直前の成功のチェックも外す）
// - 画面の破棄：戻すタイマーは止まり、後から返ったクリップボードの処理も状態を触らない
// - 共有の ScaffoldMessenger には何も出さず、ほかの発行元の通知にも触れない

const _reply = 'まず **ログ** を見ます。';

final _copyButton = find.byTooltip('返答をコピー');
final _check = find.descendant(of: _copyButton, matching: find.byIcon(Icons.check));
final _copyIcon = find.descendant(of: _copyButton, matching: find.byIcon(Icons.copy_rounded));

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

  /// 返答だけを置いた画面。[showReply] を false にするとボタンだけが外れる
  Future<ScaffoldMessengerState> pumpReply(WidgetTester tester,
      [ValueNotifier<bool>? showReply]) async {
    mockClipboard(tester);
    final show = showReply ?? ValueNotifier<bool>(true);
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(
        home: Scaffold(
          body: ValueListenableBuilder<bool>(
            valueListenable: show,
            builder: (context, visible, _) =>
                visible ? const RapiReplyMessage(text: _reply) : const SizedBox.shrink(),
          ),
        ),
      ),
    ));
    return tester.state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger));
  }

  Future<void> tapCopy(WidgetTester tester) async {
    await tester.tap(_copyButton);
    await tester.pump();
  }

  testWidgets('成功するとチェックに変わり、2秒たつと元のアイコンへ戻る。通知は出さない', (tester) async {
    await pumpReply(tester);
    expect(_copyIcon, findsOneWidget);

    await tapCopy(tester);
    expect(_check, findsOneWidget);
    expect(_copyIcon, findsNothing);

    await tester.pump(const Duration(milliseconds: 1900));
    expect(_check, findsOneWidget);
    await tester.pump(const Duration(milliseconds: 200));
    expect(_check, findsNothing);
    expect(_copyIcon, findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('失敗したらチェックに変えず、通知も出さない', (tester) async {
    await pumpReply(tester);
    failClipboard = true;

    await tapCopy(tester);
    await tester.pump(const Duration(milliseconds: 400));
    expect(_check, findsNothing);
    expect(_copyIcon, findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('成功のチェックが出ている間に失敗したら、チェックを外す', (tester) async {
    await pumpReply(tester);
    await tapCopy(tester);
    expect(_check, findsOneWidget);

    await tester.pump(const Duration(milliseconds: 500));
    failClipboard = true;
    await tapCopy(tester);
    expect(_check, findsNothing);
    expect(_copyIcon, findsOneWidget);

    // 1回目の戻すタイマーが残っていても見た目は変わらない
    await tester.pump(const Duration(seconds: 2));
    expect(_copyIcon, findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('続けて成功したら、最後の成功から2秒チェックを保つ', (tester) async {
    await pumpReply(tester);
    await tapCopy(tester);
    await tester.pump(const Duration(milliseconds: 1500));
    await tapCopy(tester);

    // 1回目から2秒を過ぎても、2回目からはまだ2秒たっていない
    await tester.pump(const Duration(milliseconds: 1000));
    expect(_check, findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1100));
    expect(_copyIcon, findsOneWidget);
  });

  testWidgets('ほかの発行元の通知（ノートに保存しました）には触れない', (tester) async {
    final messenger = await pumpReply(tester);
    messenger.showSnackBar(const SnackBar(content: Text('ノートに保存しました')));
    await tester.pumpAndSettle();

    await tapCopy(tester);
    failClipboard = true;
    await tester.pump(const Duration(milliseconds: 500));
    await tapCopy(tester);
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('ノートに保存しました'), findsOneWidget);
    expect(find.byType(SnackBar), findsOneWidget);
  });

  testWidgets('チェックが出ている間にボタンが外れても、戻すタイマーは止まり例外を出さない', (tester) async {
    final showReply = ValueNotifier<bool>(true);
    await pumpReply(tester, showReply);
    await tapCopy(tester);
    expect(_check, findsOneWidget);

    showReply.value = false;
    await tester.pump();
    expect(_copyButton, findsNothing);
    // 2秒たつ前に終える。タイマーが dispose で止まっていなければ、テスト終了時の
    // 「保留中のタイマー」検査で落ちる（2秒以上進めると発火して検査をすり抜ける）
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.takeException(), isNull);
  });

  for (final fail in [false, true]) {
    testWidgets('クリップボードの処理がボタンを外した後に${fail ? '失敗' : '成功'}で返っても、例外を出さない',
        (tester) async {
      final showReply = ValueNotifier<bool>(true);
      await pumpReply(tester, showReply);
      failClipboard = fail;
      clipboardGate = Completer<void>();

      await tapCopy(tester);
      showReply.value = false;
      await tester.pump();
      expect(_copyButton, findsNothing);

      clipboardGate!.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));
      expect(find.byType(SnackBar), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('クリップボードの処理が画面ごと破棄された後に返っても、例外を出さない', (tester) async {
    await pumpReply(tester);
    clipboardGate = Completer<void>();

    await tapCopy(tester);
    await tester.pumpWidget(const SizedBox.shrink());

    clipboardGate!.complete();
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(tester.takeException(), isNull);
  });
}
