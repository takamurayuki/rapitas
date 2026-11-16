import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rapitas_mobile/app.dart';
import 'package:rapitas_mobile/providers/pairing_provider.dart';
import 'package:rapitas_mobile/providers/realtime_refresh_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('App renders smoke test', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // テストではデスクトップへ実際に繋ぎに行かない（再接続タイマーが残ってテストが終わらないため）
          realtimeRefreshProvider.overrideWith((ref) {}),
          desktopRelocatorProvider.overrideWith((ref) {}),
        ],
        child: const RapitasMobileApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Rapitas Mobile'), findsOneWidget);
  });
}
