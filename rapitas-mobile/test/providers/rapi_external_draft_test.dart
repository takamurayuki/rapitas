import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/providers/pending_request_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/home_screen_bridge.dart';

/// ショートカット「ラピに依頼」から預かった依頼の取り込み（design.md §5.4）

class _FakeAssistant implements AssistantService {
  final List<String> routed = [];

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    routed.add(text);
    return const RoutedIntent();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeBridge implements HomeScreenBridge {
  List<PendingRapiRequest> pending = [];
  int takes = 0;

  @override
  bool get isSupported => true;

  @override
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot) async {}

  @override
  Future<List<PendingRapiRequest>> takePendingRequests() async {
    takes++;
    final out = pending;
    pending = [];
    return out;
  }
}

const _create = PendingRapiRequest(text: '明日までに資料を作るタスクを追加');
const _offline = PendingRapiRequest(text: 'レビューの状況は？', reason: 'offline');

void main() {
  late _FakeAssistant assistant;
  late _FakeBridge bridge;
  late int opened;
  late ProviderContainer container;

  setUp(() {
    assistant = _FakeAssistant();
    bridge = _FakeBridge();
    opened = 0;
    container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
      homeScreenBridgeProvider.overrideWithValue(bridge),
      rapiComposeOpenerProvider.overrideWithValue(() => opened++),
    ]);
  });
  tearDown(() => container.dispose());

  RapiChatState chat() => container.read(rapiChatProvider);
  RapiChatNotifier notifier() => container.read(rapiChatProvider.notifier);

  group('receiveExternalDraft', () {
    test('入力欄が空なら依頼を欄に入れ、案内を出す。自動では送らない', () async {
      notifier().receiveExternalDraft([_create]);
      await Future<void>.delayed(Duration.zero);

      expect(chat().input, _create.text);
      expect(chat().sending, isFalse);
      expect(assistant.routed, isEmpty);
      final notice = chat().messages.last;
      expect(notice.role, RapiRole.system);
      expect(notice.text, contains('ショートカットから届いた依頼を入力欄に入れました'));
      expect(notice.text, isNot(contains('送れなかった')));
    });

    test('書きかけの文は消さず、依頼は案内の中に並べる', () {
      notifier().setInput('書きかけ');
      notifier().receiveExternalDraft([_create, _offline]);

      expect(chat().input, '書きかけ');
      final text = chat().messages.last.text;
      expect(text, contains('書きかけの文はそのままにしています'));
      expect(text, contains('・${_create.text}'));
      expect(text, contains('・${_offline.text}'));
    });

    test('2件以上なら最後の依頼を欄に入れ、ほかは一覧にする。送れなかった依頼があればそう伝える', () {
      notifier().receiveExternalDraft([_create, _offline]);

      expect(chat().input, _offline.text);
      final text = chat().messages.last.text;
      expect(text, contains('ほかにも届いています'));
      expect(text, contains('・${_create.text}'));
      expect(text, isNot(contains('・${_offline.text}')));
      expect(text, contains('デスクトップに送れなかった'));
    });

    test('空の一覧では何もしない', () {
      final before = chat().messages.length;
      notifier().receiveExternalDraft(const []);
      expect(chat().messages.length, before);
    });
  });

  group('PendingRequestIntake', () {
    test('預かった依頼があれば下書きにして、入力欄にフォーカスした状態でラピを開く', () async {
      bridge.pending = [_create];
      final pulled = await container.read(pendingRequestIntakeProvider).pull();

      expect(pulled, isTrue);
      expect(chat().input, _create.text);
      expect(opened, 1);
      expect(assistant.routed, isEmpty);
    });

    test('預かった依頼がなければ画面を移らない', () async {
      final pulled = await container.read(pendingRequestIntakeProvider).pull();
      expect(pulled, isFalse);
      expect(opened, 0);
      expect(bridge.takes, 1);
    });
  });

  group('PendingRapiRequest.tryParse', () {
    test('ネイティブの値を読み、空の本文や形の違う値は捨てる', () {
      final r = PendingRapiRequest.tryParse(
          {'text': ' 依頼 ', 'createdAt': '2026-11-11T00:30:00Z', 'reason': 'timeout'})!;
      expect(r.text, '依頼');
      expect(r.reason, 'timeout');
      expect(r.createdAt, DateTime.utc(2026, 11, 11, 0, 30));
      expect(PendingRapiRequest.tryParse({'text': '  '}), isNull);
      expect(PendingRapiRequest.tryParse('text'), isNull);
      expect(PendingRapiRequest.tryParse({'text': 'a'})!.reason, 'needs_confirmation');
    });
  });
}
