import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_decode.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';

import '../support/rapi_controlled_assistant.dart';

// 確認済みスタンプ（nav63）：送信直後には付かず、ラピ側の最初の応答（振り分けの結果）が返った時点で
// 付く。失敗した発言には付かない。字は意図で変わり（🫡・👀・👌）、読み直しでも同じ字になる。
// 位置は吹き出しの右下。

void main() {
  late ControlledAssistant assistant;
  late ProviderContainer container;

  setUp(() {
    assistant = ControlledAssistant();
    container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
    ]);
  });
  tearDown(() => container.dispose());

  Future<void> showScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
  }

  Future<void> say(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pump();
  }

  final stamp = find.byKey(const ValueKey('rapi-received-stamp'));
  final typing = find.byKey(const ValueKey('rapi-typing'));

  Finder lineOf(String text) =>
      find.ancestor(of: find.text(text), matching: find.byType(RapiUserMessage));
  Finder stampOf(String text) => find.descendant(of: lineOf(text), matching: stamp);

  /// [text] の発言に付いたスタンプの字（無ければ null）
  String? glyphOf(WidgetTester tester, String text) {
    final s = stampOf(text);
    if (s.evaluate().isEmpty) return null;
    return tester.widget<Text>(find.descendant(of: s, matching: find.byType(Text))).data;
  }

  group('付く時点', () {
    testWidgets('送信直後（振り分けの応答前）は付かず、三点だけが出る', (tester) async {
      await showScreen(tester);
      await say(tester, '明日の会議の資料を作る');
      expect(find.text('明日の会議の資料を作る'), findsOneWidget);
      expect(typing, findsOneWidget);
      expect(stamp, findsNothing);

      assistant.succeed();
      await tester.pumpAndSettle();
    });

    testWidgets('振り分けの結果が返った時点で付く（会話の返答を待たない）', (tester) async {
      assistant.holdChat = true;
      await showScreen(tester);
      await say(tester, 'こんにちは');
      expect(stamp, findsNothing);

      assistant.succeed();
      await tester.pump();
      // 返答はまだ来ていない（三点のまま）が、読み取った印は付いている
      expect(typing, findsOneWidget);
      expect(find.text('わかりました'), findsNothing);
      expect(stampOf('こんにちは'), findsOneWidget);
      expect(find.bySemanticsLabel('ラピが確認しました'), findsOneWidget);

      assistant.releaseChat();
      await tester.pumpAndSettle();
      expect(find.text('わかりました'), findsOneWidget);
      expect(stampOf('こんにちは'), findsOneWidget);
    });

    testWidgets('送信に失敗した発言には付かない', (tester) async {
      await showScreen(tester);
      await say(tester, '届かない発言');
      assistant.fail();
      await tester.pumpAndSettle();
      expect(find.text('送信に失敗しました'), findsOneWidget);
      expect(stamp, findsNothing);
    });

    testWidgets('振り分けの後で失敗したら、付いた印を外す', (tester) async {
      assistant.holdFollowUps = false;
      await showScreen(tester);
      await say(tester, '明日の会議の資料を作る');
      assistant.succeedAs('create');
      await tester.pumpAndSettle();
      expect(find.text('送信に失敗しました'), findsOneWidget);
      expect(stamp, findsNothing);
    });
  });

  group('字は意図で変わる', () {
    for (final (intent, glyph) in [
      ('create', '🫡'),
      ('watch', '👀'),
      ('ask', '👌'),
    ]) {
      testWidgets('振り分けが $intent なら $glyph', (tester) async {
        await showScreen(tester);
        await say(tester, 'この発言');
        assistant.succeedAs(intent);
        // 振り分け先の処理（下書き・見守りの読み込み・問い合わせ）は止めてある＝ラピが処理中
        await tester.pump();
        expect(glyphOf(tester, 'この発言'), glyph);
      });
    }

    test('字の規則（モバイル／デスクトップ共通）', () {
      for (final i in ['create', 'roadmap', 'change', 'tidy', 'companion']) {
        expect(rapiStampGlyphFor(i), '🫡', reason: i);
      }
      expect(rapiStampGlyphFor('watch'), '👀');
      for (final i in ['ask', 'consult', 'chat', 'unknown', null]) {
        expect(rapiStampGlyphFor(i), '👌', reason: '$i');
      }
    });
  });

  testWidgets('読み直し：保存した記録から同じ字で戻る（印は保存しない）', (tester) async {
    await showScreen(tester);
    var n = 0;
    RapiMessage row(String role, String text, {bool inHistory = false, String kind = 'text',
            String? payload, int? taskId}) =>
        decodeSavedMessage(
            SavedMessage(
                clientId: 'c${n++}', role: role, kind: kind, text: text, inHistory: inHistory,
                payload: payload, taskId: taskId),
            id: 0);
    final chat = container.read(rapiChatProvider.notifier);
    final since = chat.beginSpace();
    chat.applySpace([
      row('user', '資料づくりをタスクにして', inHistory: true),
      row('system', 'タスク作成として受け取りました — テスト'),
      row('system', '「資料づくり」を起票しました', taskId: 3),
      row('user', '見守りの一覧を見せて', inHistory: true),
      row('system', '見守りとして受け取りました'),
      row('user', 'こんにちは', inHistory: true),
      row('assistant', 'こんにちは！', inHistory: true),
      row('user', '届かない発言'),
      row('system', '送信に失敗しました'),
      row('user', '応答を待っている間に閉じた発言', inHistory: true),
    ], since: since);
    await tester.pumpAndSettle();

    expect(glyphOf(tester, '資料づくりをタスクにして'), '🫡');
    expect(glyphOf(tester, '見守りの一覧を見せて'), '👀');
    expect(glyphOf(tester, 'こんにちは'), '👌');
    expect(glyphOf(tester, '届かない発言'), isNull);
    expect(glyphOf(tester, '応答を待っている間に閉じた発言'), isNull);
  });

  testWidgets('スタンプは吹き出しの右下の角に重なる', (tester) async {
    await showScreen(tester);
    await say(tester, 'こんにちは');
    assistant.succeed();
    await tester.pumpAndSettle();

    final bubble = tester.getRect(find.descendant(
        of: lineOf('こんにちは'), matching: find.byType(Container)).first);
    final mark = tester.getRect(stampOf('こんにちは'));
    // 右下の角にかかり、右と下へ少しはみ出す
    expect(mark.right, greaterThan(bubble.right));
    expect(mark.left, lessThan(bubble.right));
    expect(mark.bottom, greaterThan(bubble.bottom));
    expect(mark.top, lessThan(bubble.bottom));
    // はみ出した分は画面の内側（一覧の左右の余白）に収まる
    expect(mark.right, lessThan(390));
  });
}
