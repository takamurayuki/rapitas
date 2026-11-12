// 判断画面（/tasks/:id/decide、ラピ伴走化 第2段階-4）の画面テスト。
//
// 受け入れ条件：モバイルだけで、計画承認・保留解除・halt 解除を最後まで操作できる。
// 送信は本物の HumanDecisionClient を通し、Dio の手前で要求を捕まえて
// 「X-Rapitas-Source: ui が付いて、人間専用ルートへ直接届く」ことまで確かめる。
// COMPANION_SCREENSHOT_DIR を付けて走らせると、画面のキャプチャ（実フォント）も書き出す。
import 'dart:io';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/companion_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/decision/task_decision_screen.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/decision_service.dart';
import 'package:rapitas_mobile/services/human_decision_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _boundaryKey = GlobalKey();

/// 読むだけの呼び出し（計画・質問・保留の中身）に決まった応答を返す
class _ReadsClient implements ApiClient {
  final Map<String, Object?> responses;
  final List<String> paths = [];
  _ReadsClient(this.responses);

  @override
  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    paths.add(path);
    return Response<T>(
        data: responses[path] as T?, statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('判断は ApiClient から送らない: ${invocation.memberName}');
}

/// 送られた要求（パス・本文・ヘッダ）
typedef Sent = ({String path, Object? data, Map<String, dynamic> headers});

/// 送信を捕まえて、決めた状態で応答する Dio
/// [replies] があれば、要求ごとに先頭から順に使う（尽きたら [status] / [body]）
Dio _capturingDio(List<Sent> sent,
    {int status = 200, Object? body, List<({int status, Object? body})> replies = const []}) {
  final dio = Dio(BaseOptions(baseUrl: 'http://desktop.local:3001'));
  final queue = [...replies];
  dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
    sent.add((path: options.path, data: options.data, headers: options.headers));
    final reply = queue.isEmpty ? (status: status, body: body) : queue.removeAt(0);
    final status_ = reply.status;
    final response =
        Response(requestOptions: options, statusCode: status_, data: reply.body ?? {'success': true});
    if (status_ >= 400) {
      handler.reject(DioException.badResponse(statusCode: status_, requestOptions: options, response: response));
    } else {
      handler.resolve(response);
    }
  }));
  return dio;
}

Task _task({String? workflowStatus, String? haltReason, String status = 'in-progress'}) => Task(
      id: '42',
      title: '設定画面を作る',
      status: status,
      priority: 'medium',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
      workflowStatus: workflowStatus,
      haltReason: haltReason,
    );

const _plan = '# 実装計画\n\n## 変更するもの\n- 設定画面を1つ足す\n- 保存ボタンで値を送る\n\n## 完了条件\n- 保存した値が次に開いたときに出る';

late List<Sent> sent;
late _ReadsClient _reads;

Future<void> _pump(WidgetTester tester, Task task,
    {int status = 200, Object? body, List<({int status, Object? body})> replies = const []}) async {
  SharedPreferences.setMockInitialValues({});
  sent = [];
  _reads = _ReadsClient({
    '/workflow/tasks/42/files/plan': {'type': 'plan', 'exists': true, 'content': _plan},
    '/workflow/tasks/42/files/question': {
      'type': 'question',
      'exists': true,
      'content': '## 質問\n保存した値は端末ごとに分けますか、アカウントで共通にしますか？',
    },
    '/workflow/tasks/42/review-hold': {
      'success': true,
      'held': true,
      'hold': {
        'reason': 'unresolved_dispute',
        'detail': 'レビュー役の一方は保存処理の失敗時の扱いが無いと指摘しました。',
        'findings': [
          {'summary': '保存に失敗したときの表示が無い', 'severity': 'major', 'gating': true},
          {'summary': '入力の長さの上限が無い', 'severity': 'minor', 'gating': false},
        ],
      },
    },
  });
  final service = DecisionService(_reads, HumanDecisionClient(_capturingDio(sent, status: status, body: body, replies: replies)));
  final router = GoRouter(initialLocation: '/tasks', routes: [
    GoRoute(path: '/tasks', builder: (_, __) => const Scaffold(body: Text('一覧')), routes: [
      GoRoute(path: ':id/decide', builder: (_, s) => TaskDecisionScreen(taskId: s.pathParameters['id']!)),
    ]),
  ]);
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      taskDetailProvider.overrideWith((ref, id) async => task),
      taskListProvider.overrideWith((ref, filter) async => const []),
      decisionServiceProvider.overrideWithValue(service),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp.router(debugShowCheckedModeBanner: false, routerConfig: router),
    ),
  ));
  router.push('/tasks/42/decide');
  await tester.pumpAndSettle();
}

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390 * 3, 1400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

void _expectHuman(Sent s, String path, Map<String, Object?> body) {
  expect(s.path, path);
  expect(s.data, body);
  expect(s.headers['X-Rapitas-Source'], 'ui');
}

void main() {
  testWidgets('plan approval: read the plan, approve, and it reaches approve-plan as a human',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'));
    expect(find.text('あなたが決めること：計画の承認'), findsOneWidget);
    expect(find.textContaining('設定画面を1つ足す'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('decision-approve-plan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();

    expect(sent, hasLength(1));
    _expectHuman(sent.single, '/workflow/tasks/42/approve-plan', {'approved': true});
    // 送り終えたら元の画面へ戻り、結果を知らせる
    expect(find.text('一覧'), findsOneWidget);
    expect(find.text('計画を承認しました。実装に進みます。'), findsOneWidget);
  });

  // バックエンド（workflow-handlers-plan.ts）が、スキーマ変更を宣言した計画の普通の承認に返す拒否
  const schemaRefusal = (
    status: 400,
    body: {
      'success': false,
      'error': 'このplanはPrismaスキーマ変更を含みます。承認するには overrideForbiddenChange:true と overrideReason を指定してください。',
    },
  );

  testWidgets('a plan with a Prisma schema change: refused, then approved with a reason from mobile',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'), replies: [schemaRefusal]);

    await tester.tap(find.byKey(const ValueKey('decision-approve-plan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();

    // 1回目は普通の承認。断られたら画面に留まり、スキーマ変更を含むことと理由の欄を出す
    expect(sent, hasLength(1));
    _expectHuman(sent.single, '/workflow/tasks/42/approve-plan', {'approved': true});
    expect(find.byType(TaskDecisionScreen), findsOneWidget);
    expect(find.byKey(const ValueKey('decision-schema-override')), findsOneWidget);
    expect(find.text('データベースの構造が変わる計画です'), findsOneWidget);
    expect(find.byKey(const ValueKey('decision-approve-plan')), findsNothing);
    // 拒否の原文（API の項目名）はそのまま見せない
    expect(find.textContaining('overrideForbiddenChange'), findsNothing);

    // 理由が空（空白だけ）では送れない
    final approve = find.byKey(const ValueKey('decision-schema-approve'));
    expect(tester.widget<FilledButton>(approve).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('decision-schema-reason')), '   ');
    await tester.pump();
    expect(tester.widget<FilledButton>(approve).onPressed, isNull);

    await tester.enterText(find.byKey(const ValueKey('decision-schema-reason')), '  設定を保存する表が必要なため ');
    await tester.pump();
    await tester.ensureVisible(approve);
    await tester.tap(approve);
    await tester.pumpAndSettle();
    // 送る前に、理由を添えてもう一度確かめる。やめれば送らない
    expect(find.text('データベースの構造の変更を認めますか'), findsOneWidget);
    expect(find.textContaining('理由：設定を保存する表が必要なため'), findsOneWidget);
    await tester.tap(find.text('やめる'));
    await tester.pumpAndSettle();
    expect(sent, hasLength(1));

    await tester.tap(approve);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();

    // 2回目は理由付きで、同じく人の操作として approve-plan に届く
    expect(sent, hasLength(2));
    _expectHuman(sent.last, '/workflow/tasks/42/approve-plan', {
      'approved': true,
      'overrideForbiddenChange': true,
      'overrideReason': '設定を保存する表が必要なため',
    });
    expect(find.text('一覧'), findsOneWidget);
    expect(find.text('データベースの構造の変更を認めて、計画を承認しました。実装に進みます。'), findsOneWidget);
  });

  testWidgets('other plan refusals stay plain errors and do not offer the schema override',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'),
        status: 400, body: {'success': false, 'error': 'approved (boolean) is required'});
    await tester.tap(find.byKey(const ValueKey('decision-approve-plan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();
    expect(find.text('approved (boolean) is required'), findsOneWidget);
    expect(find.byKey(const ValueKey('decision-schema-override')), findsNothing);
  });

  testWidgets('a refusal of the reasoned approval is shown and keeps the reason form',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'),
        replies: [schemaRefusal, (status: 409, body: {'success': false, 'error': '計画はもう承認されています。'})]);
    await tester.tap(find.byKey(const ValueKey('decision-approve-plan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('decision-schema-reason')), '設定を保存する表が必要なため');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const ValueKey('decision-schema-approve')));
    await tester.tap(find.byKey(const ValueKey('decision-schema-approve')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();
    expect(sent, hasLength(2));
    expect(find.text('計画はもう承認されています。'), findsOneWidget);
    expect(find.byKey(const ValueKey('decision-schema-override')), findsOneWidget);
    expect(find.byType(TaskDecisionScreen), findsOneWidget);
  });

  testWidgets('plan revision goes to revise-plan with the instruction', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'));
    await tester.tap(find.byKey(const ValueKey('decision-revise-open')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('decision-revise-text')), '保存の失敗時の表示も入れてほしい');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('decision-revise-send')));
    await tester.pumpAndSettle();
    _expectHuman(sent.single, '/workflow/tasks/42/revise-plan', {'instruction': '保存の失敗時の表示も入れてほしい'});
  });

  testWidgets('a question is answered through answer-question', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'awaiting_question'));
    expect(find.textContaining('端末ごとに分けますか'), findsOneWidget);
    final send = find.byKey(const ValueKey('decision-answer-send'));
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('decision-answer-text')), 'アカウントで共通にしてください');
    await tester.pump();
    await tester.tap(send);
    await tester.pumpAndSettle();
    _expectHuman(sent.single, '/workflow/tasks/42/answer-question', {'answer': 'アカウントで共通にしてください'});
  });

  testWidgets('review hold: the reason in plain words, then accept', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision'));
    expect(find.text('2人のレビュー役の意見が割れ、検証役でも決着しませんでした。'), findsOneWidget);
    expect(find.text('保存に失敗したときの表示が無い'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('decision-hold-accept')));
    await tester.pumpAndSettle();
    _expectHuman(sent.single, '/workflow/tasks/42/review-hold/resolve', {'action': 'accept'});
  });

  testWidgets('review hold override asks first, then sends override', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision'));
    await tester.tap(find.byKey(const ValueKey('decision-hold-override')));
    await tester.pumpAndSettle();
    expect(sent, isEmpty);
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();
    _expectHuman(sent.single, '/workflow/tasks/42/review-hold/resolve', {'action': 'override'});
  });

  testWidgets('halt release needs a reason long enough, then reaches release-halt', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'budget_cost_exceeded'));
    expect(find.text('費用の上限に達したため、自動で止まっています。'), findsOneWidget);
    final send = find.byKey(const ValueKey('decision-halt-send'));
    await tester.enterText(find.byKey(const ValueKey('decision-halt-text')), '直したので');
    await tester.pump();
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('decision-halt-text')), 'テスト用の設定を直したので同じ失敗はしない');
    await tester.pump();
    await tester.tap(send);
    await tester.pumpAndSettle();
    _expectHuman(sent.single, '/workflow/tasks/42/release-halt', {'hypothesis': 'テスト用の設定を直したので同じ失敗はしない'});
  });

  testWidgets('a halt from a discarded jury result reads in plain words (batch B code)', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'verify_done', haltReason: 'jury_result_discarded'));
    expect(find.text('確認の途中で完了条件が変わったため、その判定は使わずに止めています。'), findsOneWidget);
  });

  testWidgets('a refusal from the backend is shown and nothing is popped', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'no_progress'),
        status: 409, body: {'success': false, 'error': 'not_halted'});
    await tester.enterText(find.byKey(const ValueKey('decision-halt-text')), 'テスト用の設定を直したので同じ失敗はしない');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('decision-halt-send')));
    await tester.pumpAndSettle();
    expect(find.text('このタスクはもう止まっていません。'), findsOneWidget);
    expect(find.byType(TaskDecisionScreen), findsOneWidget);
  });

  testWidgets('nothing to decide: says so and offers no buttons', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'in_progress'));
    expect(find.byKey(const ValueKey('decision-none')), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  final shotDir = Platform.environment['COMPANION_SCREENSHOT_DIR'];
  testWidgets('writes captures for visual review', (tester) async {
    await _loadRealFonts();
    _phone(tester);
    Future<void> shoot(String name) async {
      await tester.pumpAndSettle();
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$shotDir/decide_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    await _pump(tester, _task(workflowStatus: 'plan_created'));
    await shoot('plan');
    await tester.tap(find.byKey(const ValueKey('decision-revise-open')));
    await tester.pumpAndSettle();
    await shoot('plan_revise');
    await _pump(tester, _task(workflowStatus: 'plan_created'), replies: [schemaRefusal]);
    await tester.tap(find.byKey(const ValueKey('decision-approve-plan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decision-confirm')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('decision-schema-reason')), '設定を保存する表が必要なため');
    await shoot('plan_schema');
    await tester.tap(find.byKey(const ValueKey('decision-schema-approve')));
    await shoot('plan_schema_confirm');
    await _pump(tester, _task(workflowStatus: 'awaiting_question'));
    await shoot('question');
    await _pump(tester, _task(workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision'));
    await shoot('review_hold');
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'budget_cost_exceeded'));
    await tester.enterText(find.byKey(const ValueKey('decision-halt-text')), 'テスト用の設定を直したので同じ失敗はしない');
    await shoot('halt');
  }, skip: shotDir == null);
}

/// テスト用のフォントを実フォントに差し替える（キャプチャを読めるようにする）
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
