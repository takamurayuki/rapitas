/// TaskDescriptionMarkdown tests: link handling and theme-derived styles.
library;

import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/widgets/markdown/task_description_markdown.dart';

/// Taps the first link span whose text contains [label].
void tapLink(WidgetTester tester, String label) {
  for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
    TapGestureRecognizer? found;
    rich.text.visitChildren((span) {
      if (span is TextSpan &&
          (span.text ?? '').contains(label) &&
          span.recognizer is TapGestureRecognizer) {
        found = span.recognizer as TapGestureRecognizer;
        return false;
      }
      return true;
    });
    if (found != null) {
      found!.onTap!();
      return;
    }
  }
  fail('link "$label" not found');
}

void main() {
  group('parseLaunchableLink', () {
    test('accepts http, https and mailto', () {
      expect(parseLaunchableLink('https://example.com/a?b=1'),
          Uri.parse('https://example.com/a?b=1'));
      expect(parseLaunchableLink(' http://example.com '), Uri.parse('http://example.com'));
      expect(parseLaunchableLink('mailto:a@example.com'), Uri.parse('mailto:a@example.com'));
    });

    test('refuses other schemes, relative and empty targets', () {
      for (final href in [
        null,
        '',
        '   ',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'intent://scan#Intent;end',
        '/tasks/1',
        'docs/readme.md',
        'https:',
      ]) {
        expect(parseLaunchableLink(href), isNull, reason: href);
      }
    });
  });

  group('TaskDescriptionMarkdown links', () {
    Future<List<Uri>> pump(WidgetTester tester, String data, {bool result = true}) async {
      final opened = <Uri>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TaskDescriptionMarkdown(
            data: data,
            launcher: (uri) async {
              opened.add(uri);
              return result;
            },
          ),
        ),
      ));
      return opened;
    }

    testWidgets('opens an https link through the launcher', (tester) async {
      final opened = await pump(tester, '[公式サイト](https://example.com/docs)');
      tapLink(tester, '公式サイト');
      await tester.pump();
      expect(opened, [Uri.parse('https://example.com/docs')]);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('refuses a javascript: link and tells the user', (tester) async {
      final opened = await pump(tester, '[危険](javascript:alert(1))');
      tapLink(tester, '危険');
      await tester.pump();
      expect(opened, isEmpty);
      expect(find.textContaining('リンクを開けませんでした'), findsOneWidget);
    });

    testWidgets('reports a link the platform could not open', (tester) async {
      final opened = await pump(tester, '[公式サイト](https://example.com)', result: false);
      tapLink(tester, '公式サイト');
      await tester.pump();
      expect(opened, hasLength(1));
      expect(find.textContaining('リンクを開けませんでした'), findsOneWidget);
    });
  });

  // The launcher can stay pending while the user leaves the detail screen
  // (e.g. the OS "open with" sheet). Its late result must not reach whatever
  // screen is showing by then.
  group('TaskDescriptionMarkdown links after the screen is closed', () {
    late Completer<bool> pending;

    /// Opens a detail route holding the Markdown, taps its link and leaves
    /// the launcher unfinished.
    Future<void> tapThenLeavePending(WidgetTester tester) async {
      pending = Completer<bool>();
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        navigatorKey: navigatorKey,
        home: const Scaffold(body: Text('一覧')),
      ));
      navigatorKey.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          body: TaskDescriptionMarkdown(
            data: '[公式サイト](https://example.com)',
            launcher: (_) => pending.future,
          ),
        ),
      ));
      await tester.pumpAndSettle();
      tapLink(tester, '公式サイト');
      await tester.pump();
      navigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.text('一覧'), findsOneWidget);
    }

    testWidgets('a late false result shows nothing on the previous screen',
        (tester) async {
      await tapThenLeavePending(tester);
      pending.complete(false);
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a late launcher error shows nothing on the previous screen',
        (tester) async {
      await tapThenLeavePending(tester);
      pending.completeError(Exception('no handler'));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a late result after the whole app is gone does not throw',
        (tester) async {
      await tapThenLeavePending(tester);
      // Disposes the ScaffoldMessenger the tap handler looked up.
      await tester.pumpWidget(const SizedBox());
      pending.complete(false);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('buildTaskDescriptionStyleSheet', () {
    // Theme.of() returns the theme merged with typography geometry (font
    // sizes); the raw ThemeData has none, so read it from a real tree.
    Future<ThemeData> resolved(WidgetTester tester, ThemeData theme) async {
      late ThemeData result;
      await tester.pumpWidget(MaterialApp(
        theme: theme,
        home: Builder(builder: (context) {
          result = Theme.of(context);
          return const SizedBox();
        }),
      ));
      return result;
    }

    for (final entry in {
      'light': AppTheme.lightTheme,
      'dark': AppTheme.darkTheme,
    }.entries) {
      testWidgets('${entry.key}: body matches the former plain description', (tester) async {
        final theme = await resolved(tester, entry.value);
        final sheet = buildTaskDescriptionStyleSheet(theme);
        final body = theme.textTheme.bodyMedium!;
        expect(sheet.p!.fontSize, body.fontSize);
        expect(sheet.p!.color, body.color);
        expect(sheet.tableBody!.color, body.color);
        expect(sheet.listBullet!.color, body.color);
        // Readable: light text on dark surfaces and vice versa.
        final isDark = theme.brightness == Brightness.dark;
        expect(sheet.p!.color!.computeLuminance() > 0.5, isDark);
        expect(sheet.code!.color!.computeLuminance() > 0.5, isDark);
      });

      testWidgets('${entry.key}: accents and surfaces come from the colour scheme',
          (tester) async {
        final theme = await resolved(tester, entry.value);
        final scheme = theme.colorScheme;
        final sheet = buildTaskDescriptionStyleSheet(theme);
        expect(sheet.a!.color, scheme.primary);
        expect(sheet.checkbox!.color, scheme.primary);
        expect(sheet.code!.color, scheme.onSurface);
        expect(sheet.code!.backgroundColor, scheme.surfaceContainerHighest);
        expect((sheet.codeblockDecoration! as BoxDecoration).color,
            scheme.surfaceContainerHighest);
        expect((sheet.blockquoteDecoration! as BoxDecoration).color,
            scheme.surfaceContainerHigh);
        // Headings never outgrow the task title (headlineSmall).
        expect(sheet.h1!.fontSize!, lessThan(theme.textTheme.headlineSmall!.fontSize!));
      });
    }
  });
}
