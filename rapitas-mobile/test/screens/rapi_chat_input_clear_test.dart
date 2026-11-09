import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 送信したら入力欄に文が残らないこと（文字入力・音声入力・タブ往復）と、
// 失敗したときは送れなかった文が欄に戻ることを確かめる。

/// 振り分けの応答をテストから返す AssistantService（未振り分け → 会話で返す）
class _ControlledAssistant implements AssistantService {
  final List<String> routed = [];
  final List<Completer<RoutedIntent>> _pending = [];

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) {
    routed.add(text);
    final c = Completer<RoutedIntent>();
    _pending.add(c);
    return c.future;
  }

  void succeed() => _pending.removeAt(0).complete(const RoutedIntent());
  void fail() => _pending.removeAt(0).completeError(Exception('network'));

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: 'わかりました');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 終わったあとにも結果を流せる聞き取りの偽物（遅れて届く確定結果の再現用）
class _LateDictation implements DictationService {
  void Function(String words)? onWords;
  void Function(DictationEnd end)? onEnd;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    this.onWords = onWords;
    this.onEnd = onEnd;
    return null;
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {}
}

void main() {
  late _ControlledAssistant assistant;
  late _LateDictation dictation;
  late ProviderContainer container;

  setUp(() {
    assistant = _ControlledAssistant();
    dictation = _LateDictation();
    container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
      dictationServiceProvider.overrideWithValue(dictation),
    ]);
  });
  tearDown(() => container.dispose());

  /// 同じ provider のまま画面を出す／外す（タブ切り替えで RapiScreen が破棄・再生成されるのと同じ）
  Future<void> showScreen(WidgetTester tester, {bool visible = true}) async {
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: visible ? const RapiScreen() : const SizedBox()),
    ));
    await tester.pump();
  }

  /// タブを離れて戻る
  Future<void> switchTabs(WidgetTester tester) async {
    await showScreen(tester, visible: false);
    expect(find.byType(RapiScreen), findsNothing);
    await showScreen(tester);
  }

  String fieldText(WidgetTester tester) =>
      tester.widget<TextField>(find.byType(TextField)).controller!.text;
  String providerInput() => container.read(rapiChatProvider).input;

  final send = find.byKey(const ValueKey('rapi-send'));
  final mic = find.byKey(const ValueKey('rapi-mic'));

  group('送信したら入力欄に残さない', () {
    testWidgets('文字で送信すると、応答を待つ間も成功後も欄は空。タブを往復しても空のまま', (tester) async {
      await showScreen(tester);
      await tester.enterText(find.byType(TextField), '明日の会議の資料を作る');
      await tester.pump();
      expect(providerInput(), '明日の会議の資料を作る');

      await tester.tap(send);
      await tester.pump();
      // 送った時点で欄は空、文は自分の発言として並ぶ
      expect(assistant.routed, ['明日の会議の資料を作る']);
      expect(fieldText(tester), '');
      expect(providerInput(), '');
      expect(find.text('明日の会議の資料を作る'), findsOneWidget);

      assistant.succeed();
      await tester.pumpAndSettle();
      expect(find.text('わかりました'), findsOneWidget);
      expect(fieldText(tester), '');
      expect(providerInput(), '');
      expect(mic, findsOneWidget); // 空なので送信ではなくマイク

      await switchTabs(tester);
      expect(fieldText(tester), '');
      expect(find.text('やりたいことをそのまま書いてください'), findsOneWidget);
      // 送った文は発言として1回だけ（欄には戻っていない）
      expect(find.text('明日の会議の資料を作る'), findsOneWidget);
    });

    testWidgets('応答待ちのうちにタブを離れて戻っても、送った文は欄に戻らない', (tester) async {
      await showScreen(tester);
      await tester.enterText(find.byType(TextField), '進行中のタスクは？');
      await tester.pump();
      await tester.tap(send);
      await tester.pump();

      await switchTabs(tester);
      expect(fieldText(tester), '');

      await showScreen(tester, visible: false);
      assistant.succeed(); // 画面が無い間に応答が届く
      await tester.pump();
      await showScreen(tester);
      await tester.pumpAndSettle();
      expect(fieldText(tester), '');
      expect(find.text('わかりました'), findsOneWidget);
    });

    testWidgets('失敗したら送れなかった文が欄に戻り、タブを往復しても残る', (tester) async {
      await showScreen(tester);
      await tester.enterText(find.byType(TextField), '資料を作る');
      await tester.pump();
      await tester.tap(send);
      await tester.pump();
      expect(fieldText(tester), '');

      assistant.fail();
      await tester.pumpAndSettle();
      expect(find.text('送信に失敗しました'), findsOneWidget);
      expect(fieldText(tester), '資料を作る');
      expect(providerInput(), '資料を作る');
      expect(send, findsOneWidget);

      await switchTabs(tester);
      expect(fieldText(tester), '資料を作る');
    });

    testWidgets('応答待ちに書き足した次の文だけが残り、送った文は残らない', (tester) async {
      await showScreen(tester);
      await tester.enterText(find.byType(TextField), '一つ目');
      await tester.pump();
      await tester.tap(send);
      await tester.pump();

      await tester.enterText(find.byType(TextField), '二つ目');
      await tester.pump();
      assistant.succeed();
      await tester.pumpAndSettle();
      expect(fieldText(tester), '二つ目');

      // 失敗しても、書き始めた次の文は送れなかった文で上書きしない
      await tester.tap(send);
      await tester.pump();
      await tester.enterText(find.byType(TextField), '三つ目');
      await tester.pump();
      assistant.fail();
      await tester.pumpAndSettle();
      expect(fieldText(tester), '三つ目');
      expect(find.text('二つ目'), findsOneWidget); // 送れなかった文は発言として残る
    });

    testWidgets('音声で送信したあとに結果が遅れて届いても、欄に書き戻さない', (tester) async {
      await showScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.onWords!('明日の予定');
      await tester.pump();
      dictation.onEnd!(DictationEnd.completed);
      await tester.pump();
      expect(assistant.routed, ['明日の予定']);
      expect(fieldText(tester), '');

      dictation.onWords!('明日の予定は？'); // 終わった聞き取りからの遅れた結果
      await tester.pump();
      expect(fieldText(tester), '');

      assistant.succeed();
      await tester.pumpAndSettle();
      expect(fieldText(tester), '');
      await switchTabs(tester);
      expect(fieldText(tester), '');
    });
  });
}
