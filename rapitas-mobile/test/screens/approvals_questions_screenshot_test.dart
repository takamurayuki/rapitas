/// nav80 captures with DUMMY data for visual review (390pt wide, real Noto
/// CJK fonts) of the approvals page with agent questions: (1) a question card
/// with question text, (2) an answer being typed, (3) approvals and questions
/// listed together.
///
/// Set APPROVALS_SCREENSHOT_DIR to write them; CI leaves it unset, so the
/// test is skipped there.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/approvals/approvals_screen.dart';

void main() {
  final dir = Platform.environment['APPROVALS_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures for nav80', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    // 影をテスト既定の黒い輪郭ではなく実際の描画にする（body の最後で戻す）
    debugDisableShadows = false;

    final now = DateTime.now();
    final questions = [
      ExecutingTask(
        executionId: '9001',
        sessionId: '1',
        taskId: '501',
        executionStatus: 'waiting_for_input',
        startedAt: now.subtract(const Duration(minutes: 42)),
        question: '【ダミー】ログイン画面の修正を develop と release/1.4 のどちらに入れますか？'
            'release に入れる場合は既存の文言変更も一緒に取り込みます。',
      ),
      ExecutingTask(
        executionId: '9002',
        sessionId: '2',
        taskId: '502',
        executionStatus: 'waiting_for_input',
        startedAt: now.subtract(const Duration(minutes: 8)),
      ),
    ];
    final titles = {'501': '【ダミー】ログイン画面のエラー表示', '502': '【ダミー】通知設定の整理'};
    final approvals = [
      ApprovalRequest(
        id: 'a1',
        title: '【ダミー】依存パッケージの更新',
        description: '【ダミー】dio を 5.7 に上げる変更の承認をお願いします',
        requestType: 'code_change',
        createdAt: now.subtract(const Duration(hours: 2)),
      ),
      ApprovalRequest(
        id: 'a2',
        title: '【ダミー】本番環境への反映',
        createdAt: now.subtract(const Duration(minutes: 15)),
      ),
    ];

    Future<void> shoot(String name, {required List<ApprovalRequest> approvals, String? typing}) async {
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(ProviderScope(
        key: UniqueKey(),
        overrides: [
          approvalListProvider.overrideWith((ref) async => approvals),
          executingTasksProvider.overrideWith((ref) async => questions),
          taskTitleLookupProvider.overrideWithValue(titles),
        ],
        child: RepaintBoundary(
          key: boundaryKey,
          // 画像だけでダミーと分かるよう、アプリの上に帯を出す（アプリ本体は変えない）
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: Column(
              children: [
                Container(
                  width: double.infinity,
                  color: const Color(0xFFB71C1C),
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: const Text(
                    'ダミーデータの確認画像（nav80）',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontFamily: 'Roboto', fontSize: 12, color: Color(0xFFFFFFFF)),
                  ),
                ),
                Expanded(
                  child: MaterialApp(
                    debugShowCheckedModeBanner: false,
                    theme: AppTheme.lightTheme,
                    home: const ApprovalsScreen(),
                  ),
                ),
              ],
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      if (typing != null) {
        await tester.enterText(find.byKey(const ValueKey('question-input-9001')), typing);
        await tester.pump();
      }
      // 入力欄のカーソル点滅は止まらないので、一定時間だけ進めてから撮る
      await tester.pump(const Duration(seconds: 1));
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_approvals_nav80_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    // ① 質問カード（質問文あり。2件目は質問文の無い待ち）
    await shoot('1_question_card', approvals: const []);
    // ② 回答を入力中（送信ボタンが押せる状態）
    await shoot('2_answer_typing', approvals: const [], typing: '【ダミー】develop に入れてください。release には次の定期リリースで入れます。');
    // ③ 承認と質問が両方ある一覧（承認が先）
    await shoot('3_approvals_and_questions', approvals: approvals);
    // Must be restored inside the body: the painting-vars check runs before tearDowns.
    debugDisableShadows = true;
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
