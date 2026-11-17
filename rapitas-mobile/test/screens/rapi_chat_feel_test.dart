import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_typing_indicator.dart';

import '../support/rapi_controlled_assistant.dart';

// 確認済みスタンプ（ラピが読み取った発言にだけ付き、返答後・タブ往復後も残る。失敗した発言には付かない。
// 付く時点と字の詳細は rapi_read_stamp_test.dart）と、
// 考え中の波打つ三点（文言・スピナーなし。pumpAndSettle が終わる）を確かめる。

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

  Future<void> showScreen(WidgetTester tester, {bool visible = true}) async {
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: visible ? const RapiScreen() : const SizedBox()),
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

  Finder stampOf(String text) => find.descendant(
        of: find.ancestor(of: find.text(text), matching: find.byType(RapiUserMessage)),
        matching: stamp,
      );

  double liftOf(WidgetTester tester, int dot) => -tester
      .widget<Transform>(find.byKey(ValueKey('rapi-typing-dot-$dot')))
      .transform
      .getTranslation()
      .y;

  group('確認済みスタンプ', () {
    // NOTE: 送信と同時に付く「受け付け」から、応答が返ってから付く「確認済み」に替えた（nav63）
    testWidgets('送信中は付かず、応答が返ると付き、返答後もタブを往復しても残る', (tester) async {
      await showScreen(tester);
      expect(stamp, findsNothing);

      await say(tester, '明日の会議の資料を作る');
      expect(typing, findsOneWidget);
      expect(stamp, findsNothing);

      assistant.succeed();
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('ラピが確認しました'), findsOneWidget);
      expect(find.text('わかりました'), findsOneWidget);
      expect(typing, findsNothing);
      expect(stampOf('明日の会議の資料を作る'), findsOneWidget);

      await showScreen(tester, visible: false);
      await showScreen(tester);
      expect(stampOf('明日の会議の資料を作る'), findsOneWidget);
    });

    testWidgets('送信に失敗した発言には付かない（確認済みの別の発言には付いたまま）', (tester) async {
      await showScreen(tester);
      await say(tester, '一つ目');
      assistant.succeed();
      await tester.pumpAndSettle();

      await say(tester, '二つ目');
      assistant.fail();
      await tester.pumpAndSettle();
      expect(find.text('送信に失敗しました'), findsOneWidget);
      expect(find.text('二つ目'), findsWidgets);
      expect(stamp, findsOneWidget);
      expect(stampOf('一つ目'), findsOneWidget);
    });

    testWidgets('ラピの発言には付かない', (tester) async {
      await showScreen(tester);
      await say(tester, 'こんにちは');
      assistant.succeed();
      await tester.pumpAndSettle();
      final rapiLine =
          find.ancestor(of: find.text('わかりました'), matching: find.byType(RapiReplyMessage));
      expect(rapiLine, findsOneWidget);
      expect(find.descendant(of: rapiLine, matching: stamp), findsNothing);
      expect(stamp, findsOneWidget);
    });
  });

  group('考え中の波打つ三点', () {
    testWidgets('三つの点だけで、文言とスピナーは出さない。pumpAndSettle は終わる', (tester) async {
      await showScreen(tester);
      await say(tester, '進行中のタスクは？');

      // 送信中のまま pumpAndSettle を呼んでもタイムアウトしない（終わらないアニメーションを使わない）
      await tester.pumpAndSettle();
      expect(typing, findsOneWidget);
      for (var i = 0; i < 3; i++) {
        expect(find.byKey(ValueKey('rapi-typing-dot-$i')), findsOneWidget);
      }
      expect(find.text('考え中…'), findsNothing);
      expect(find.descendant(of: typing, matching: find.byType(CircularProgressIndicator)),
          findsNothing);
      expect(find.descendant(of: typing, matching: find.byType(Text)), findsNothing);

      assistant.succeed();
      await tester.pumpAndSettle();
      expect(typing, findsNothing);
    });

    testWidgets('点は位相をずらして上下し、時間とともに入れ替わる', (tester) async {
      await showScreen(tester);
      await say(tester, '進行中のタスクは？');

      // 最初のコマは三つとも休んでいるので、1コマ進めてから見る
      await tester.pump(rapiTypingStep);
      final first = [for (var i = 0; i < 3; i++) liftOf(tester, i)];
      // 同じ時刻では点ごとに高さが違う（位相がずれている）
      expect(first.toSet().length, greaterThan(1));

      await tester.pump(rapiTypingStep * 2);
      final later = [for (var i = 0; i < 3; i++) liftOf(tester, i)];
      expect(later, isNot(equals(first)));
      for (final lift in [...first, ...later]) {
        expect(lift, inInclusiveRange(0, rapiTypingMaxLift));
      }

      assistant.succeed();
      await tester.pumpAndSettle();
    });

    testWidgets('アニメーションを切る設定では動かさない', (tester) async {
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: true),
            child: RapiScreen(),
          ),
        ),
      ));
      await tester.pump();
      await say(tester, '進行中のタスクは？');
      await tester.pump(rapiTypingStep * 3);
      for (var i = 0; i < 3; i++) {
        expect(liftOf(tester, i), 0);
      }
      assistant.succeed();
      await tester.pumpAndSettle();
    });
  });

  test('位相：1周で元に戻り、隣の点とはずれる', () {
    for (var dot = 0; dot < 3; dot++) {
      expect(rapiTypingLift(rapiTypingSteps, dot), rapiTypingLift(0, dot));
    }
    expect(rapiTypingLift(2, 0), isNot(rapiTypingLift(2, 1)));
    expect(rapiTypingLift(rapiTypingDotLag + 2, 1), rapiTypingLift(2, 0));
  });
}
