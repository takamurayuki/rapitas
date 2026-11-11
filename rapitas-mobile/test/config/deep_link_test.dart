import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/compose_requests.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';

/// ディープリンク rapitas://app/<パス> のルーティング（design.md §4）

class _FakeAssistant implements AssistantService {
  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// OS からアプリにディープリンクが届いたときと同じ経路（flutter/navigation の pushRouteInformation）で URL を渡す
Future<void> _openUrl(WidgetTester tester, String url) async {
  final message = const JSONMethodCodec().encodeMethodCall(
    MethodCall('pushRouteInformation', {'location': url, 'state': null}),
  );
  await tester.binding.defaultBinaryMessenger
      .handlePlatformMessage(SystemChannels.navigation.name, message, (_) {});
  await tester.pump();
  await tester.pump();
}

void main() {
  group('redirectFor', () {
    late ComposeRequests compose;
    setUp(() => compose = ComposeRequests());

    test('/rapi?compose=1 はクエリを落とした /rapi へ送り、フォーカスを1回だけ要求する', () {
      expect(AppRoutes.redirectFor(Uri.parse('/rapi?compose=1'), compose), '/rapi');
      expect(compose.take(), isTrue);
      expect(compose.take(), isFalse);
    });

    test('スキームとホスト付きの URL もパスだけで判断する', () {
      expect(AppRoutes.redirectFor(Uri.parse('rapitas://app/rapi?compose=1'), compose), '/rapi');
      expect(compose.hasPending, isTrue);
      expect(AppRoutes.redirectFor(Uri.parse('rapitas://app/approvals'), compose), isNull);
    });

    test('compose のない /rapi はそのまま（要求も出さない）', () {
      expect(AppRoutes.redirectFor(Uri.parse('/rapi'), compose), isNull);
      expect(AppRoutes.redirectFor(Uri.parse('/rapi?compose=0'), compose), isNull);
      expect(compose.hasPending, isFalse);
    });

    test('既知の画面（可変部分を含む）はそのまま通す', () {
      for (final path in [
        '/',
        '/tasks',
        '/tasks/new',
        '/tasks/123',
        '/tasks/123/edit',
        '/executions',
        '/approvals',
        '/themes/5/edit',
        '/categories/new',
        '/hypotheses',
      ]) {
        expect(AppRoutes.redirectFor(Uri.parse(path), compose), isNull, reason: path);
      }
    });

    test('知らないパスはホームへ', () {
      for (final path in ['/nope', '/tasks/1/2/3', '/rapi/extra', '/settingsx']) {
        expect(AppRoutes.redirectFor(Uri.parse(path), compose), '/', reason: path);
      }
    });

    test('ホスト部だけでパスが空の URL はホーム扱い', () {
      expect(AppRoutes.redirectFor(Uri.parse('rapitas://rapi'), compose), isNull);
    });
  });

  testWidgets('OS から rapitas://app/rapi?compose=1 が届くと /rapi を開き、入力欄にフォーカスする',
      (tester) async {
    final compose = ComposeRequests();
    final router = AppRoutes.createRouter(
      tracker: VoiceRouteTracker(),
      initialLocation: AppRoutes.rapi,
      composeRequests: compose,
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [assistantServiceProvider.overrideWithValue(_FakeAssistant())],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pump();

    final field = find.byKey(const ValueKey('rapi-input'));
    bool focused() => tester.widget<TextField>(field).focusNode!.hasFocus;
    expect(focused(), isFalse);

    await _openUrl(tester, 'rapitas://app/rapi?compose=1');

    expect(router.routerDelegate.currentConfiguration.uri.toString(), '/rapi');
    expect(focused(), isTrue);
    expect(compose.hasPending, isFalse);
    // 下タブは「チャット」が選ばれたまま
    expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 4);
  });
}
