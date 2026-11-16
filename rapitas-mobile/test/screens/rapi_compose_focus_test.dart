import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/compose_requests.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

/// ウィジェット・ショートカットから開いたときの、入力欄へのフォーカス（design.md §4.3）

class _FakeDictation implements DictationService {
  int cancels = 0;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async =>
      null;

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async => cancels++;
}

class _FakeAssistant implements AssistantService {
  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late ComposeRequests compose;
  late _FakeDictation dictation;

  setUp(() {
    compose = ComposeRequests();
    dictation = _FakeDictation();
  });

  Widget app({Key? key}) => ProviderScope(
        overrides: [
          dictationServiceProvider.overrideWithValue(dictation),
          assistantServiceProvider.overrideWithValue(_FakeAssistant()),
        ],
        child: MaterialApp(home: RapiScreen(key: key, composeRequests: compose)),
      );

  final field = find.byKey(const ValueKey('rapi-input'));
  TextField input(WidgetTester tester) => tester.widget<TextField>(field);
  bool focused(WidgetTester tester) => input(tester).focusNode!.hasFocus;

  testWidgets('開いている画面に要求が届くと、入力欄にフォーカスしてキーボードを求める', (tester) async {
    await tester.pumpWidget(app());
    await tester.pump();
    expect(focused(tester), isFalse);

    compose.request();
    await tester.pump();

    expect(focused(tester), isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
  });

  testWidgets('画面より先に出ていた要求（コールドスタート）も受け取り、作り直しでは二重にフォーカスしない',
      (tester) async {
    compose.request();
    await tester.pumpWidget(app(key: const ValueKey('first')));
    await tester.pump();
    expect(focused(tester), isTrue);

    // タブを往復したのと同じく、画面を作り直す
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpWidget(app(key: const ValueKey('second')));
    await tester.pump();
    expect(focused(tester), isFalse);
  });

  testWidgets('聞き取り中に要求が届いたら、聞き取りを捨ててから入力欄にフォーカスする', (tester) async {
    await tester.pumpWidget(app());
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-mic')));
    await tester.pump();
    expect(input(tester).readOnly, isTrue);

    compose.request();
    await tester.pump();
    await tester.pump();

    expect(dictation.cancels, 1);
    expect(input(tester).readOnly, isFalse);
    expect(focused(tester), isTrue);
  });
}
