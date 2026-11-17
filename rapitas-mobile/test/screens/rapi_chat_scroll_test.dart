import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_jump_to_latest.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';

import '../support/rapi_controlled_assistant.dart';

// 末尾ジャンプの ▽（最下部から離れたときだけ出て、押すと最下部へ行き消える）と、
// 新着の自動スクロールの条件（自分が送った直後と、既に最下部付近にいたときだけ）を確かめる。

void main() {
  late ControlledAssistant assistant;
  late ProviderContainer container;

  setUp(() {
    assistant = ControlledAssistant()
      ..reply = List.generate(14, (i) => '返答の${i + 1}行目です。').join('\n\n');
    container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
    ]);
  });
  tearDown(() => container.dispose());

  final jump = find.byKey(const ValueKey('rapi-jump-to-latest'));
  final list = find.byType(ListView);

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

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  /// 長い返答が並んだ、画面に収まらない会話を作る
  Future<void> longConversation(WidgetTester tester) async {
    for (var i = 1; i <= 3; i++) {
      await send(tester, '質問$i');
      assistant.succeed();
      await tester.pumpAndSettle();
    }
  }

  ScrollPosition position(WidgetTester tester) =>
      tester.state<ScrollableState>(find.byType(Scrollable).first).position;

  double distanceToEnd(WidgetTester tester) {
    final p = position(tester);
    return p.maxScrollExtent - p.pixels;
  }

  /// 上へ読み戻る（指で下へ引く）
  Future<void> readBack(WidgetTester tester, [double by = 700]) async {
    await tester.drag(list, Offset(0, by));
    await tester.pumpAndSettle();
  }

  testWidgets('最下部にいる間は出さず、離れると出て、押すと最下部へ行って消える', (tester) async {
    await showScreen(tester);
    await longConversation(tester);
    expect(position(tester).maxScrollExtent, greaterThan(rapiJumpThreshold * 2));
    expect(distanceToEnd(tester), lessThan(1));
    expect(jump, findsNothing);

    // 少しだけ戻った（閾値未満）なら出さない
    await readBack(tester, 60);
    expect(distanceToEnd(tester), lessThan(rapiJumpThreshold));
    expect(jump, findsNothing);

    await readBack(tester);
    expect(distanceToEnd(tester), greaterThanOrEqualTo(rapiJumpThreshold));
    expect(jump, findsOneWidget);
    expect(find.byIcon(Icons.keyboard_arrow_down), findsOneWidget);

    await tester.tap(jump);
    await tester.pumpAndSettle();
    expect(distanceToEnd(tester), lessThan(1));
    expect(jump, findsNothing);
  });

  testWidgets('上へ戻って読んでいる間に返答が届いても、読む位置は動かさない', (tester) async {
    await showScreen(tester);
    await longConversation(tester);

    await send(tester, '質問4');
    expect(distanceToEnd(tester), lessThan(1)); // 送った直後は末尾へ寄せる
    await readBack(tester);
    final reading = position(tester).pixels;

    assistant.succeed();
    await tester.pumpAndSettle();
    expect(position(tester).pixels, closeTo(reading, 1));
    expect(distanceToEnd(tester), greaterThan(rapiJumpThreshold));
    expect(jump, findsOneWidget);
  });

  testWidgets('最下部付近にいれば、届いた返答まで寄せる', (tester) async {
    await showScreen(tester);
    await longConversation(tester);

    await send(tester, '質問4');
    assistant.succeed();
    await tester.pumpAndSettle();
    expect(distanceToEnd(tester), lessThan(1));
    expect(find.text('質問4'), findsOneWidget);
    expect(jump, findsNothing);
  });

  testWidgets('上へ戻っていても、自分が送ったら末尾へ寄せる', (tester) async {
    await showScreen(tester);
    await longConversation(tester);
    await readBack(tester);
    expect(jump, findsOneWidget);

    await send(tester, '質問4');
    expect(distanceToEnd(tester), lessThan(1));
    expect(jump, findsNothing);

    assistant.succeed();
    await tester.pumpAndSettle();
  });
}
