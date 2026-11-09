import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/voice_service.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';

/// 聞き取りの偽物。テストから途中結果・終わりを流し込む
class _FakeDictation implements DictationService {
  DictationStartFailure? startFailure;

  /// 開始処理が投げる例外（端末側の開始失敗を真似る）
  Object? startError;
  int starts = 0;
  int stops = 0;
  int cancels = 0;
  void Function(String words)? _onWords;
  void Function(DictationEnd end)? _onEnd;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    starts++;
    if (startError != null) throw startError!;
    if (startFailure != null) return startFailure;
    _onWords = onWords;
    _onEnd = onEnd;
    return null;
  }

  void words(String w) => _onWords!(w);

  void end(DictationEnd e) {
    final cb = _onEnd!;
    _onWords = null;
    _onEnd = null;
    cb(e);
  }

  @override
  Future<void> stop() async => stops++;

  @override
  Future<void> cancel() async {
    cancels++;
    _onWords = null;
    _onEnd = null;
  }
}

/// 振り分けなし → 会話で返すだけの AssistantService
class _FakeAssistant implements AssistantService {
  final List<String> routed = [];

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    routed.add(text);
    return const RoutedIntent();
  }

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: 'わかりました');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _FakeDictation dictation;
  late _FakeAssistant assistant;

  Future<void> pumpScreen(WidgetTester tester) async {
    dictation = _FakeDictation();
    assistant = _FakeAssistant();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        dictationServiceProvider.overrideWithValue(dictation),
        assistantServiceProvider.overrideWithValue(assistant),
      ],
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
  }

  String fieldText(WidgetTester tester) =>
      tester.widget<TextField>(find.byType(TextField).first).controller!.text;

  final mic = find.byKey(const ValueKey('rapi-mic'));
  final send = find.byKey(const ValueKey('rapi-send'));

  group('チャットの音声入力', () {
    testWidgets('欄が空ならマイク、文字を入れると送信ボタンに替わる', (tester) async {
      await pumpScreen(tester);
      expect(mic, findsOneWidget);
      expect(send, findsNothing);

      await tester.enterText(find.byType(TextField), 'こんにちは');
      await tester.pump();
      expect(send, findsOneWidget);
      expect(mic, findsNothing);
    });

    testWidgets('開始 → 途中結果 → 確定 で、そのまま送信される', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();

      expect(dictation.starts, 1);
      expect(find.text('聞き取り中…'), findsOneWidget);
      // 聞き取り中は送信ボタンではなく、止めるためのマイクを出し続ける
      expect(find.byTooltip('聞き取りを終える'), findsOneWidget);

      dictation.words('明日');
      await tester.pump();
      expect(fieldText(tester), '明日');
      expect(mic, findsOneWidget);

      dictation.words('明日の会議の資料を作る');
      await tester.pump();
      expect(fieldText(tester), '明日の会議の資料を作る');
      expect(assistant.routed, isEmpty);

      dictation.end(DictationEnd.completed);
      await tester.pumpAndSettle();

      expect(assistant.routed, ['明日の会議の資料を作る']);
      expect(find.text('明日の会議の資料を作る'), findsOneWidget); // 自分の発言として並ぶ
      expect(find.text('わかりました'), findsOneWidget);
      expect(fieldText(tester), '');
      expect(find.text('やりたいことをそのまま書いてください'), findsOneWidget);
    });

    testWidgets('聞き取り中にマイクを押すと停止を頼み、確定後に送信される', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('進行中のタスクは？');
      await tester.pump();

      await tester.tap(mic);
      await tester.pump();
      expect(dictation.stops, 1);
      expect(assistant.routed, isEmpty);

      dictation.end(DictationEnd.completed);
      await tester.pumpAndSettle();
      expect(assistant.routed, ['進行中のタスクは？']);
    });

    testWidgets('結果が空なら送信せず、案内を出す', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();

      dictation.end(DictationEnd.noSpeech);
      await tester.pumpAndSettle();

      expect(assistant.routed, isEmpty);
      expect(find.text('声を聞き取れなかったので、送信しませんでした。'), findsOneWidget);
      expect(find.text('やりたいことをそのまま書いてください'), findsOneWidget);
      expect(mic, findsOneWidget);
    });

    testWidgets('空白だけの結果で普通に終わっても送信しない', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('  ');
      await tester.pump();

      dictation.end(DictationEnd.completed);
      await tester.pumpAndSettle();
      expect(assistant.routed, isEmpty);
      expect(find.text('声を聞き取れなかったので、送信しませんでした。'), findsOneWidget);
    });

    testWidgets('認識に失敗したら送信せず、途中までの文は欄に残す', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('資料を');
      await tester.pump();

      dictation.end(DictationEnd.failed);
      await tester.pumpAndSettle();
      expect(assistant.routed, isEmpty);
      expect(find.text('音声をうまく認識できなかったので、送信しませんでした。'), findsOneWidget);
      expect(fieldText(tester), '資料を');
      expect(send, findsOneWidget);
    });

    testWidgets('途中結果のあと無音（noSpeech）で終わったら送信せず、文は欄に残す', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('資料を');
      await tester.pump();

      dictation.end(DictationEnd.noSpeech);
      await tester.pumpAndSettle();
      expect(assistant.routed, isEmpty);
      expect(find.text('声を聞き取れなかったので、送信しませんでした。'), findsOneWidget);
      expect(fieldText(tester), '資料を');
      expect(send, findsOneWidget);

      // 欄に残った文は手で確かめて送れる
      await tester.tap(send);
      await tester.pumpAndSettle();
      expect(assistant.routed, ['資料を']);
    });

    testWidgets('開始処理が例外を投げたら idle に戻り、欄は編集でき、送信しない', (tester) async {
      await pumpScreen(tester);
      dictation.startError = Exception('listen failed');
      await tester.tap(mic);
      await tester.pumpAndSettle();

      expect(find.text('この端末では音声入力を使えませんでした。'), findsOneWidget);
      expect(find.text('聞き取り中…'), findsNothing);
      expect(tester.widget<TextField>(find.byType(TextField).first).readOnly, isFalse);
      expect(dictation.cancels, 1);
      expect(assistant.routed, isEmpty);

      // 欄に文字を入れられ、マイクの再タップも受け付ける
      await tester.enterText(find.byType(TextField).first, '手で書く');
      await tester.pump();
      expect(fieldText(tester), '手で書く');
      expect(send, findsOneWidget);
      await tester.enterText(find.byType(TextField).first, '');
      await tester.pump();
      dictation.startError = null;
      await tester.tap(mic);
      await tester.pump();
      expect(dictation.starts, 2);
      expect(find.text('聞き取り中…'), findsOneWidget);
      expect(assistant.routed, isEmpty);
    });

    testWidgets('権限が無ければ聞き取らず、理由を出す', (tester) async {
      await pumpScreen(tester);
      dictation.startFailure = DictationStartFailure.permissionDenied;
      await tester.tap(mic);
      await tester.pumpAndSettle();

      expect(find.textContaining('マイクと音声認識を許可してください'), findsOneWidget);
      expect(find.text('聞き取り中…'), findsNothing);
      expect(assistant.routed, isEmpty);
    });

    testWidgets('認識結果は 2000 字で切る', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('あ' * 2100);
      await tester.pump();
      expect(fieldText(tester).length, 2000);
    });

    testWidgets('聞き取り中に画面が破棄されたら聞き取りを捨て、送信しない', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();
      dictation.words('途中まで');
      await tester.pump();

      // タブ切り替えと同じく RapiScreen を外す（ProviderScope は残る）
      await tester.pumpWidget(ProviderScope(
        overrides: [
          dictationServiceProvider.overrideWithValue(dictation),
          assistantServiceProvider.overrideWithValue(assistant),
        ],
        child: const MaterialApp(home: SizedBox()),
      ));
      expect(dictation.cancels, 1);
      expect(assistant.routed, isEmpty);
    });

    testWidgets('聞き取り中に上へ画面が積まれたら聞き取りを捨てる', (tester) async {
      await pumpScreen(tester);
      await tester.tap(mic);
      await tester.pump();

      final nav = tester.state<NavigatorState>(find.byType(Navigator));
      nav.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('詳細'))));
      await tester.pumpAndSettle();
      expect(dictation.cancels, 1);

      nav.pop();
      await tester.pumpAndSettle();
      expect(find.text('聞き取り中…'), findsNothing);
      expect(mic, findsOneWidget);
    });
  });

  group('SpeechDictationService', () {
    late _FakeVoice voice;
    late SpeechDictationService service;
    late List<String> words;
    late List<DictationEnd> ends;

    setUp(() {
      voice = _FakeVoice();
      service = SpeechDictationService(voice);
      words = [];
      ends = [];
    });

    Future<DictationStartFailure?> start() =>
        service.start(onWords: words.add, onEnd: ends.add);

    SpeechRecognitionResult result(String w, {bool last = false}) =>
        SpeechRecognitionResult([SpeechRecognitionWords(w, null, 0.9)], last);

    test('ja_JP・上限30秒で聞き取り、確定結果で1回だけ終わる', () async {
      expect(await start(), isNull);
      expect(voice.localeId, 'ja_JP');
      expect(voice.listenFor, const Duration(seconds: 30));

      voice.onResult!(result('明日'));
      voice.onStatus!('notListening'); // Android は確定前に来る。ここでは終わらない
      expect(ends, isEmpty);
      voice.onResult!(result('明日の予定', last: true));
      voice.onStatus!('done');
      expect(words, ['明日', '明日の予定']);
      expect(ends, [DictationEnd.completed]);
    });

    test('no_match は「聞き取れなかった」、それ以外のエラーは失敗', () async {
      await start();
      voice.onError!(SpeechRecognitionError('error_no_match', true));
      expect(ends, [DictationEnd.noSpeech]);

      ends.clear();
      await start();
      voice.onError!(SpeechRecognitionError('error_network', true));
      expect(ends, [DictationEnd.failed]);
    });

    test('使えないときは権限の有無で理由を分ける', () async {
      voice.available = false;
      voice.permitted = false;
      expect(await start(), DictationStartFailure.permissionDenied);
      voice.permitted = true;
      expect(await start(), DictationStartFailure.unavailable);
    });

    test('聞き取りの開始が例外を投げたら後始末して「使えない」を返す', () async {
      voice.listenError = Exception('listen failed');
      expect(await start(), DictationStartFailure.unavailable);
      expect(voice.cancels, 1);
      // 途中まで登録された受け手から届いても、終わりは出さない
      voice.onResult!(result('遅れて', last: true));
      voice.onStatus!('done');
      expect(words, isEmpty);
      expect(ends, isEmpty);

      // 次の聞き取りは普通に始められる
      voice.listenError = null;
      expect(await start(), isNull);
      voice.onResult!(result('次', last: true));
      expect(ends, [DictationEnd.completed]);
    });

    test('initialize が例外を投げても「使えない」を返す', () async {
      voice.initError = Exception('init failed');
      expect(await start(), DictationStartFailure.unavailable);
      expect(ends, isEmpty);
    });

    test('権限の確認中に cancel → 次の開始のあと、古い確認が例外でも次の聞き取りを止めない', () async {
      voice.available = false;
      final gate = Completer<bool>();
      voice.permissionGate = gate;
      final oldStart = start();
      await Future<void>.delayed(Duration.zero); // 古い方を hasPermission の待ちまで進める
      expect(voice.permissionChecks, 1);

      await service.cancel();
      final cancelsBeforeNext = voice.cancels;

      // 次の聞き取りを始める
      voice.available = true;
      voice.permissionGate = null;
      final nextWords = <String>[];
      final nextEnds = <DictationEnd>[];
      expect(await service.start(onWords: nextWords.add, onEnd: nextEnds.add), isNull);

      // 古い権限確認が例外で落ちる
      gate.completeError(Exception('permission check failed'));
      expect(await oldStart, isNull);
      expect(voice.cancels, cancelsBeforeNext); // 次の聞き取りを cancelListening しない

      // 次の聞き取りはそのまま続く
      voice.onResult!(result('次の文', last: true));
      expect(nextWords, ['次の文']);
      expect(nextEnds, [DictationEnd.completed]);
      expect(words, isEmpty);
      expect(ends, isEmpty);
    });

    test('権限の確認中に cancel されたら、確認の結果に関わらず null を返す', () async {
      voice.available = false;
      voice.permitted = false;
      final gate = Completer<bool>();
      voice.permissionGate = gate;
      final oldStart = start();
      await Future<void>.delayed(Duration.zero);
      await service.cancel();
      final cancels = voice.cancels;
      gate.complete(false);
      expect(await oldStart, isNull);
      expect(voice.cancels, cancels);
      expect(ends, isEmpty);
    });

    test('cancel したあとの結果・終わりは届かない', () async {
      await start();
      await service.cancel();
      expect(voice.cancels, 1);
      voice.onResult!(result('遅れて', last: true));
      expect(words, isEmpty);
      expect(ends, isEmpty);
    });
  });
}

class _FakeVoice implements VoiceService {
  bool available = true;
  bool permitted = true;
  Object? initError;
  Object? listenError;
  int cancels = 0;
  String? localeId;
  Duration? listenFor;
  void Function(SpeechRecognitionResult)? onResult;
  void Function(SpeechRecognitionError)? onError;
  void Function(String)? onStatus;

  @override
  Future<bool> initialize() async {
    if (initError != null) throw initError!;
    return available;
  }

  /// 設定すると hasPermission はこれが完了するまで待つ（競合の再現用）
  Completer<bool>? permissionGate;
  int permissionChecks = 0;

  @override
  Future<bool> get hasPermission {
    permissionChecks++;
    return permissionGate?.future ?? Future.value(permitted);
  }

  @override
  Future<bool> startListening({
    required void Function(SpeechRecognitionResult result) onResult,
    void Function(SpeechRecognitionError error)? onError,
    void Function(String status)? onStatus,
    String localeId = 'ja_JP',
    Duration? listenFor,
  }) async {
    this.onResult = onResult;
    this.onError = onError;
    this.onStatus = onStatus;
    this.localeId = localeId;
    this.listenFor = listenFor;
    if (listenError != null) throw listenError!;
    return true;
  }

  @override
  Future<void> stopListening() async {}

  @override
  Future<void> cancelListening() async => cancels++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
