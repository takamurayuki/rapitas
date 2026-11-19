/// Execution log sheet (nav79): writes PNG captures with DUMMY data for visual
/// review (390pt wide, real Noto CJK fonts) — the running timeline, waiting for
/// input with the question visible, an error, and the raw log behind 詳細.
///
/// Set EXEC_LOG_SCREENSHOT_DIR to write them; CI leaves it unset, so the test
/// is skipped there.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';
import 'package:rapitas_mobile/widgets/execution_log/execution_log.dart';

import '../../services/execution_log/execution_log_fixtures.dart';

ExecutionLogSnapshot _snap(List<Map<String, dynamic>> rows,
        {String status = 'running', String? question, String? errorMessage}) =>
    ExecutionLogSnapshot.fromJson({
      'status': status,
      'logs': rows,
      if (question != null) 'question': question,
      if (errorMessage != null) 'errorMessage': errorMessage,
    });

final _running = _snap([
  ...claudeHappyPath.sublist(0, 17),
  logRow(17, '[Tool Done: Bash] (21.4s)\n', time: at(31)),
  logRow(18, 'テストは通りました。続けて、エラー文言を【ダミー】仕様書の表記にそろえます。\n'
      '対象は login_screen.dart と login_messages.dart の2ファイルです。\n'
      '変更後にもう一度テストを実行し、画面の表示も確認します。\n'
      '問題があれば元に戻して別の方法を検討します。\n', time: at(33)),
  logRow(19, '\n[Tool: Edit] -> login_messages.dart\n', time: at(36)),
]);

final _waiting = _snap(claudeQuestion,
    status: 'waiting_for_input', question: '通知の既定値はオンとオフのどちらにしますか？');

// 実行中の作業2行を挟むので、claudeError の後半は sequence を2つ後ろへずらす
final _error = _snap([
  ...claudeError.sublist(0, 1),
  logRow(1, '\n[Tool: Bash] \$ flutter test\n', time: at(2)),
  logRow(2, '[Tool Done: Bash] (1.2s)\n', time: at(3)),
  for (final row in claudeError.sublist(1)) {...row, 'sequence': (row['sequence'] as int) + 2},
], status: 'failed', errorMessage: 'API rate limit exceeded（ダミー）');

void main() {
  final dir = Platform.environment['EXEC_LOG_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the nav79 execution log sheet', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final shots = <String, (ExecutionLogSnapshot, bool)>{
      '1_running_timeline': (_running, false),
      '2_waiting_question': (_waiting, false),
      '3_error': (_error, false),
      '4_raw_detail': (_running, true),
    };
    for (final shot in shots.entries) {
      final container = ProviderContainer(overrides: [
        taskExecutionLogsProvider.overrideWith((ref, key) async => shot.value.$1),
        executionLogPollIntervalProvider.overrideWithValue(null),
      ]);
      addTearDown(container.dispose);
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(UncontrolledProviderScope(
        key: UniqueKey(),
        container: container,
        child: RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: Scaffold(
              appBar: AppBar(title: const Text('実行（ダミーデータの確認画像）')),
              body: Builder(
                builder: (context) => Center(
                  child: FilledButton(
                    key: const ValueKey('open'),
                    onPressed: () => showExecutionLogSheet(context,
                        title: '【ダミー】ログイン画面のエラー表示を直す', taskId: '812', executionId: '2806'),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.byKey(const ValueKey('open')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      if (shot.value.$2) {
        await tester.tap(find.byKey(const ValueKey('exec-log-raw-toggle')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
      }
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_exec_log_nav79_${shot.key}.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }
  }, skip: dir == null);
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    // 生ログ・作業の内訳は monospace 指定。同じ CJK フォントを当てて豆腐にしない
    'monospace': ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'],
    'MaterialIcons': ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'],
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      final file = File(path);
      if (!file.existsSync()) continue;
      loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }
}
