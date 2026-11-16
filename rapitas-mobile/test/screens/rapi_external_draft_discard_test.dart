import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/compose_requests.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../support/home_screen_fakes.dart';

/// ショートカットから届いた依頼の案内に出る「この依頼を破棄」（PR #1473 レビュー指摘 P1 の明示破棄）

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('欄に入れた依頼の案内にだけ「破棄」が出て、押すと欄が空になり、案内から消える', (tester) async {
    final container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(FakeAssistant()),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: RapiScreen(composeRequests: ComposeRequests())),
    ));
    container.read(rapiChatProvider.notifier).receiveExternalDraft([createRequest]);
    await tester.pumpAndSettle();

    final discard = find.text('この依頼を破棄');
    expect(discard, findsOneWidget);
    expect(find.widgetWithText(TextField, createRequest.text), findsOneWidget);

    await tester.tap(discard);
    await tester.pumpAndSettle();

    expect(container.read(rapiChatProvider).input, isEmpty);
    expect(discard, findsNothing);
    expect(find.textContaining('依頼を破棄しました'), findsOneWidget);
  });
}
