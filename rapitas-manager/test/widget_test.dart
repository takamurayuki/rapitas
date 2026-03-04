import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rapitas_manager/app.dart';

void main() {
  testWidgets('App renders smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: RapitasManagerApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Rapitas Manager'), findsOneWidget);
  });
}
