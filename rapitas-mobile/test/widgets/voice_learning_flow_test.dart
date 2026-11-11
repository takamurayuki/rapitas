// 聞き間違いの補正辞書：0件のときの近い候補・補正の適用・誤学習の防止（設計 §1.4・§2・§3・§7.3）
//
// 偽物の構成は voice_command_test.dart と同じ（そちらは 754 行あるので、学習のテストはこのファイルに分けた）。
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_learning_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_command_flow.dart';
import 'package:rapitas_mobile/services/voice_learning_store.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:rapitas_mobile/widgets/voice_input_sheet.dart';
import 'package:rapitas_mobile/widgets/voice_mode_host.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeDictation implements DictationService {
  void Function(String words)? _onWords;
  void Function(DictationEnd end)? _onEnd;

  bool get active => _onEnd != null;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    _onWords = onWords;
    _onEnd = onEnd;
    return null;
  }

  void say(String words) {
    _onWords!(words);
    final end = _onEnd!;
    _onWords = null;
    _onEnd = null;
    end(DictationEnd.completed);
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {
    _onWords = null;
    _onEnd = null;
  }
}

class _FakeApprovals implements ApprovalService {
  final List<ApprovalRequest> items;
  final List<String> approved = [];
  bool fail = false;

  _FakeApprovals(this.items);

  @override
  Future<List<ApprovalRequest>> getApprovals() async => items;

  @override
  Future<void> approve(String id) async {
    if (fail) throw Exception('通信エラー');
    approved.add(id);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTasks implements TaskService {
  final List<Task> tasks;
  final List<Map<String, dynamic>> created = [];

  _FakeTasks(this.tasks);

  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async =>
      tasks.where((t) => status == null || t.status == status).toList();

  @override
  Future<Task> createTask(Map<String, dynamic> data) async {
    created.add(data);
    return _task('99', data['title'] as String);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeBacklog implements BacklogService {
  final List<Hypothesis> hypotheses;
  final List<(String, String)> statusUpdates = [];
  final List<String> deletedHypotheses = [];

  _FakeBacklog(this.hypotheses);

  @override
  Future<List<Hypothesis>> getHypotheses() async => hypotheses;

  @override
  Future<void> updateHypothesisStatus(String id, String status) async => statusUpdates.add((id, status));

  @override
  Future<void> deleteHypothesis(String id) async => deletedHypotheses.add(id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => [TaskTheme(id: '10', name: '開発'), TaskTheme(id: '11', name: '英語学習')];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeRapiChat extends RapiChatNotifier {
  @override
  Future<void> send() async {}
}

/// シートなしの実行（runDirect）用の画面の外の操作
class _RecordingUi implements VoiceUi {
  final List<String> pushed = [];
  final List<String> went = [];
  final List<String> messages = [];

  @override
  void attachSheet(Route<dynamic> route) {}
  @override
  void closeSheet() {}
  @override
  void go(String path) => went.add(path);
  @override
  void push(String path, {Object? extra}) => pushed.add(path);
  @override
  bool back() => false;
  @override
  bool closePopup() => false;
  @override
  bool scroll(String path, {required bool down}) => false;
  @override
  bool refresh(String path) => false;
  @override
  void showMessage(String message) => messages.add(message);
}

Task _task(String id, String title) => Task(
      id: id,
      title: title,
      status: 'todo',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

ApprovalRequest _approval(String id, String title) =>
    ApprovalRequest(id: id, title: title, status: 'pending', createdAt: DateTime(2026, 11, 9));

Hypothesis _hypothesis(String id, String statement) =>
    Hypothesis(id: id, statement: statement, rationale: '', domain: '', status: 'open', confidence: 0.5);

/// 保存済みの学習データ（SharedPreferences の中身）
Map<String, Object> _learned(List<(VoiceTargetKind, String, String, String)> entries, {bool? enabled}) => {
      if (enabled != null) VoiceLearningEnabledNotifier.prefsKey: enabled,
      VoiceLearningStore.prefsKey: jsonEncode({
        'version': 1,
        'corrections': [
          for (final (kind, heard, id, label) in entries)
            {
              'kind': kind.name,
              'heard': heard,
              'heardText': heard,
              'targetId': id,
              'label': label,
              'count': 1,
              'createdAt': DateTime.now().toIso8601String(),
              'lastUsedAt': DateTime.now().toIso8601String(),
            },
        ],
        'targetUsage': [],
        'commandUsage': [],
      }),
    };

// 「ロビン画面」は「ログイン画面」の聞き違い。ログイン画面の◯◯ が2件あり、どちらにも部分一致しない
final _approvals = [_approval('1', 'ログイン画面の変更'), _approval('2', 'API の追加'), _approval('3', 'ログイン画面のテスト')];

void main() {
  late _FakeDictation dictation;
  late _FakeApprovals approvals;
  late _FakeTasks tasks;
  late _FakeBacklog backlog;
  late GoRouter router;
  late ProviderContainer container;
  late VoiceRouteTracker tracker;

  Future<void> pumpApp(
    WidgetTester tester,
    String initialLocation, {
    Map<String, Object> prefs = const {},
    List<Task> taskItems = const [],
    List<Hypothesis> hypothesisItems = const [],
  }) async {
    SharedPreferences.setMockInitialValues(prefs);
    dictation = _FakeDictation();
    approvals = _FakeApprovals(_approvals);
    tasks = _FakeTasks(taskItems);
    backlog = _FakeBacklog(hypothesisItems);
    tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: initialLocation);
    container = ProviderContainer(overrides: [
      dictationServiceProvider.overrideWithValue(dictation),
      approvalServiceProvider.overrideWithValue(approvals),
      taskServiceProvider.overrideWithValue(tasks),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      backlogServiceProvider.overrideWithValue(backlog),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => _FakeRapiChat()),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();
    // 設定画面と同じく、保存済みの学習データを読み込んでおく（読み込み前の空の状態を「消えた」と取り違えないため）
    await container.read(voiceLearningProvider.notifier).ready;
  }

  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> openSheet(WidgetTester tester) async {
    final navigatorContext = router.routerDelegate.navigatorKey.currentContext!;
    final ui = AppVoiceUi(router: router, messenger: ScaffoldMessenger.of(navigatorContext), tracker: tracker);
    VoiceInputSheet.show(navigatorContext, path: router.state.uri.path, ui: ui);
    await settle(tester);
    expect(dictation.active, isTrue, reason: '開くと聞き取りを始める');
  }

  Future<void> say(WidgetTester tester, String words) async {
    expect(dictation.active, isTrue, reason: '「$words」の前に聞き取りが始まっていない');
    dictation.say(words);
    await settle(tester);
  }

  Future<void> finish(WidgetTester tester) async => settle(tester, 20);

  List<VoiceCorrection> learned() => container.read(voiceLearningProvider);
  const nearPrompt = '「ロビン画面」に当たる承認リクエストは見つかりませんでした。近いものを番号で選んでください（違うなら「キャンセル」）';

  group('0件のときの近い候補', () {
    testWidgets('近い候補の一覧が出る → 2を選ぶ → はい → 実行され、学習データに1件入る', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text(nearPrompt), findsOneWidget);
      // 候補は近い順・同点は画面順（API の追加は近くないので出ない）
      final sheet = find.byType(VoiceInputSheet);
      expect(find.descendant(of: sheet, matching: find.text('ログイン画面の変更')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('ログイン画面のテスト')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('API の追加')), findsNothing);
      expect(learned(), isEmpty);

      await say(tester, '2番');
      expect(find.text('「ログイン画面のテスト」を承認しますか？'), findsOneWidget);
      expect(learned(), isEmpty, reason: '確定するのは成功したときだけ');
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['3']);
      final c = learned().single;
      expect((c.kind, c.heard, c.targetId, c.label, c.count),
          (VoiceTargetKind.approval, 'ロビン画面', '3', 'ログイン画面のテスト', 1));
      // 端末内に保存されている
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(VoiceLearningStore.prefsKey), contains('ロビン画面'));
    });

    testWidgets('近いものが1件も無ければ今までどおり失敗にする', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, '請求書を承認');
      expect(find.text('「請求書」に当たる承認リクエストが見つかりません'), findsOneWidget);
      await finish(tester);
      expect(approvals.approved, isEmpty);
    });
  });

  group('補正の適用', () {
    final robin = (VoiceTargetKind.approval, 'ロビン画面', '3', 'ログイン画面のテスト');

    testWidgets('学習済みの断片を言うと、一覧を出さずに確認で対象名を出す（補正の旨を note に出す）', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([robin]));
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text(nearPrompt), findsNothing);
      expect(find.text('「ロビン画面」は前に「ログイン画面のテスト」を選んだので、それを対象にします'), findsOneWidget);
      expect(find.text('「ログイン画面のテスト」を承認しますか？'), findsOneWidget, reason: '承認は補正でも必ず確認する');
      expect(approvals.approved, isEmpty);
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['3']);
      expect(learned().single.count, 2, reason: '適用して成功した回数も数える');
    });

    testWidgets('本物の名前の一致があれば学習は見ない', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([(VoiceTargetKind.approval, 'api', '1', 'ログイン画面の変更')]));
      await openSheet(tester);
      await say(tester, 'APIを承認');
      expect(find.text('「API の追加」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['2']);
    });

    testWidgets('補正で決めた仮説の状態変更は、確認を出す（番号・名前の一致なら出さない操作）', (tester) async {
      await pumpApp(tester, '/hypotheses',
          prefs: _learned([(VoiceTargetKind.hypothesis, 'ロビン画面', 'h1', 'ログイン画面を速くする')]),
          hypothesisItems: [_hypothesis('h1', 'ログイン画面を速くする'), _hypothesis('h2', '請求書を自動化する')]);
      await openSheet(tester);
      await say(tester, 'ロビン画面を立証にする');
      expect(find.textContaining('「ログイン画面を速くする」を「'), findsOneWidget);
      expect(find.textContaining('にしますか？'), findsOneWidget);
      expect(backlog.statusUpdates, isEmpty, reason: '確認の前には変えない');
      await say(tester, 'はい');
      await finish(tester);
      expect(backlog.statusUpdates, [('h1', 'supported')]);
    });

    testWidgets('補正で決めた対象の確認に「いいえ」と答えると、その対応を消す', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([robin]));
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      await say(tester, 'いいえ');
      await finish(tester);
      expect(approvals.approved, isEmpty);
      expect(learned(), isEmpty);
    });

    testWidgets('学習した ID がいまの一覧に無ければ使わず近い候補を出す。データは消さない', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([(VoiceTargetKind.approval, 'ロビン画面', 'gone', '消えた承認')]));
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text(nearPrompt), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('voice-close')));
      await finish(tester);
      expect(learned().single.targetId, 'gone');
    });

    testWidgets('学習した対象が改名されていても ID で使い、名前をいまの名前に変える', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([(VoiceTargetKind.approval, 'ロビン画面', '3', '古い名前')]));
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text('「ログイン画面のテスト」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      await finish(tester);
      expect(learned().single.label, 'ログイン画面のテスト');
    });

    testWidgets('音声で削除が成功したら、その ID の対応を消す', (tester) async {
      await pumpApp(tester, '/hypotheses',
          prefs: _learned([(VoiceTargetKind.hypothesis, 'ロビン画面', 'h1', 'ログイン画面を速くする')]),
          hypothesisItems: [_hypothesis('h1', 'ログイン画面を速くする'), _hypothesis('h2', '請求書を自動化する')]);
      await openSheet(tester);
      await say(tester, 'ロビン画面を削除');
      expect(find.textContaining('「ログイン画面を速くする」を削除しますか？'), findsOneWidget);
      await say(tester, 'はい');
      await finish(tester);
      expect(backlog.deletedHypotheses, ['h1']);
      expect(learned(), isEmpty);
    });

    testWidgets('近い候補で選んだ対象を音声で削除しても、消えた ID は覚えない', (tester) async {
      await pumpApp(tester, '/hypotheses',
          hypothesisItems: [_hypothesis('h1', 'ログイン画面を速くする'), _hypothesis('h2', '請求書を自動化する')]);
      await openSheet(tester);
      await say(tester, 'ロビン画面を削除');
      await say(tester, '1番');
      await say(tester, 'はい');
      await finish(tester);
      expect(backlog.deletedHypotheses, ['h1']);
      expect(learned(), isEmpty);
    });

    testWidgets('タスク作成のテーマが補正で決まったときだけ、テーマで作成するか確かめる', (tester) async {
      await pumpApp(tester, '/tasks', prefs: _learned([(VoiceTargetKind.theme, 'かいはつ', '10', '開発')]));
      await openSheet(tester);
      await say(tester, 'タスクを作成');
      await say(tester, '資料の準備');
      await say(tester, 'かいはつ');
      expect(find.text('テーマ「開発」で作成しますか？'), findsOneWidget);
      await say(tester, 'はい');
      await say(tester, 'なし'); // 優先度
      await finish(tester);
      expect(tasks.created.single['themeId'], 10);
      expect(learned().single.count, 2);
    });
  });

  group('シートなしの実行', () {
    // NOTE: tester.runAsync で包むと、偽の時計の側で作られた future を待って止まる。
    // 音声操作モードのテストと同じく偽の時計のまま走らせ、pump で進めて結果を受け取る
    Future<(bool, _RecordingUi)> runDirect(WidgetTester tester, String path, String text) async {
      final ui = _RecordingUi();
      final flow = VoiceCommandFlow(path: path, dictation: dictation, container: container, ui: ui);
      bool? done;
      unawaited(flow.runDirect(text).then((v) => done = v));
      for (var i = 0; i < 50 && done == null; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      flow.dispose();
      expect(done, isNotNull, reason: 'runDirect が終わらない');
      return (done!, ui);
    }

    testWidgets('学習済みの断片で「開いて」と言うと、確認が要るのでシートに回る（画面は変えない）', (tester) async {
      await pumpApp(tester, '/tasks',
          prefs: _learned([(VoiceTargetKind.task, 'ロビン画面', '1', 'ログイン画面の修正')]),
          taskItems: [_task('1', 'ログイン画面の修正'), _task('2', '資料作成')]);
      final (done, ui) = await runDirect(tester, '/tasks', 'ロビン画面を開いて');
      expect(done, isFalse, reason: 'シートが要る');
      expect(ui.pushed, isEmpty);
      expect(learned().single.count, 1, reason: '何もしていないので数えない');
    });

    testWidgets('近い候補の選択が要るときもシートに回る', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', 'ログイン画面の修正'), _task('2', '資料作成')]);
      final (done, ui) = await runDirect(tester, '/tasks', 'ロビン画面を開いて');
      expect(done, isFalse);
      expect(ui.pushed, isEmpty);
    });

    testWidgets('テーマの絞り込みは補正でも確認せずに適用し、補正したことをスナックバーに出す', (tester) async {
      await pumpApp(tester, '/tasks', prefs: _learned([(VoiceTargetKind.theme, 'かいはつ', '10', '開発')]));
      final (done, ui) = await runDirect(tester, '/tasks', 'かいはつのタスク');
      expect(done, isTrue);
      expect(container.read(taskFilterProvider).themeId, '10');
      expect(ui.messages, ['テーマ「開発」のタスクを表示しました（「かいはつ」は前に選んだ「開発」として扱いました）']);
    });
  });

  group('誤学習の防止', () {
    testWidgets('候補を選んだあとの確認で「いいえ」なら記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      await say(tester, '2番');
      await say(tester, 'いいえ');
      await finish(tester);
      expect(approvals.approved, isEmpty);
      expect(learned(), isEmpty);
    });

    testWidgets('候補を選んだあとシートを閉じたら記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      await say(tester, '2番');
      await tester.tap(find.byKey(const ValueKey('voice-close')));
      await finish(tester);
      expect(learned(), isEmpty);
    });

    testWidgets('候補の選択で「キャンセル」なら記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      await say(tester, 'キャンセル');
      await finish(tester);
      expect(learned(), isEmpty);
    });

    testWidgets('実行が失敗したら記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      approvals.fail = true;
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      await say(tester, '2番');
      await say(tester, 'はい');
      await finish(tester);
      expect(find.textContaining('承認に失敗しました'), findsOneWidget);
      expect(learned(), isEmpty);
    });

    testWidgets('失敗のあとに別の言い方で言い直して成功しても記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, '請求書を承認');
      expect(find.textContaining('見つかりません'), findsOneWidget);
      await say(tester, 'ログイン画面のテストを承認');
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['3']);
      expect(learned(), isEmpty);
    });

    testWidgets('曖昧な一覧（2件以上当たる）で選んで成功しても補正には記録しない', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ログイン画面を承認');
      expect(find.textContaining('件あります。番号で選んでください'), findsOneWidget);
      await say(tester, '2番');
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['3']);
      expect(learned(), isEmpty);
    });
  });

  group('オフ', () {
    final robin = (VoiceTargetKind.approval, 'ロビン画面', '3', 'ログイン画面のテスト');

    testWidgets('オフなら学習データを使わず、選んで成功しても記録しない。データは残り、オンに戻すとまた使う', (tester) async {
      await pumpApp(tester, '/approvals', prefs: _learned([robin], enabled: false));
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text(nearPrompt), findsOneWidget, reason: '学習を使わず、近い候補を出す');
      await say(tester, '1番');
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['1']);
      final kept = learned().single;
      expect((kept.targetId, kept.count), ('3', 1), reason: '置き換えも数えもしない');

      await container.read(voiceLearningEnabledProvider.notifier).setEnabled(true);
      await openSheet(tester);
      await say(tester, 'ロビン画面を承認');
      expect(find.text('「ログイン画面のテスト」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      await finish(tester);
      expect(approvals.approved, ['1', '3']);
    });
  });
}
