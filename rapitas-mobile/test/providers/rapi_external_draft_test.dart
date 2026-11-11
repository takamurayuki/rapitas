import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/pending_request_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/external_draft_inbox.dart';
import 'package:rapitas_mobile/services/home_screen_bridge.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../support/home_screen_fakes.dart';

/// ショートカット「ラピに依頼」から届いた依頼の、下書きとしての受け取り（design.md §5.4）。
/// 再起動をまたいだ保持は external_draft_persistence_test.dart

void main() {
  late FakeAssistant assistant;
  late FakeHomeScreenBridge bridge;
  late int opened;
  late ProviderContainer container;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    assistant = FakeAssistant();
    bridge = FakeHomeScreenBridge();
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
      expect(notifier().receiveExternalDraft([createRequest]), isTrue);
      await Future<void>.delayed(Duration.zero);

      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
      expect(chat().sending, isFalse);
      expect(assistant.routed, isEmpty);
      final notice = chat().messages.last;
      expect(notice.role, RapiRole.system);
      expect(notice.text, contains('ショートカットから届いた依頼を入力欄に入れました'));
      expect(notice.text, isNot(contains('送れなかった')));
      expect(notice.externalDraftId, createRequest.id, reason: '案内に「破棄」を出せる');
    });

    test('書きかけの文は消さず、依頼は案内の中に並べる', () {
      notifier().setInput('書きかけ');
      notifier().receiveExternalDraft([createRequest, offlineRequest]);

      expect(chat().input, '書きかけ');
      expect(chat().activeExternalDraftId, isNull);
      final text = chat().messages.last.text;
      expect(text, contains('書きかけの文はそのままにしています'));
      expect(text, contains('・${createRequest.text}'));
      expect(text, contains('・${offlineRequest.text}'));
    });

    test('2件以上なら最新の依頼を欄に入れ、ほかは一覧にする。送れなかった依頼があればそう伝える', () {
      notifier().receiveExternalDraft([createRequest, offlineRequest]);

      expect(chat().input, offlineRequest.text);
      final text = chat().messages.last.text;
      expect(text, contains('ほかにも届いています'));
      expect(text, contains('・${createRequest.text}'));
      expect(text, isNot(contains('・${offlineRequest.text}')));
      expect(text, contains('デスクトップに送れなかった'));
    });

    test('空の一覧と、受け取り済みの依頼では何もしない', () {
      final before = chat().messages.length;
      expect(notifier().receiveExternalDraft(const []), isFalse);
      notifier().receiveExternalDraft([createRequest]);
      expect(notifier().receiveExternalDraft([createRequest]), isFalse);
      expect(chat().messages.length, before + 1);
    });
  });

  group('送信と破棄', () {
    test('欄の依頼を送れたら、残りの最新を次に欄へ入れる', () async {
      notifier().receiveExternalDraft([createRequest, offlineRequest]);
      await notifier().send();

      expect(assistant.routed, [offlineRequest.text]);
      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
      expect(chat().messages.last.text, contains('次の依頼を入力欄に入れました'));
    });

    test('送れなかったら依頼は欄に残り、破棄もできる', () async {
      notifier().receiveExternalDraft([createRequest]);
      assistant.failNext = true;
      await notifier().send();

      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
    });

    test('破棄すると欄を空にする。手を入れた文は残す', () async {
      notifier().receiveExternalDraft([createRequest, offlineRequest]);
      await notifier().discardExternalDraft();
      expect(chat().input, createRequest.text, reason: '最新を破棄したので次が入る');
      expect(chat().activeExternalDraftId, createRequest.id);

      notifier().setInput('${createRequest.text}（午後に）');
      await notifier().discardExternalDraft();
      expect(chat().input, '${createRequest.text}（午後に）');
      expect(chat().activeExternalDraftId, isNull);
      expect(chat().messages.any((m) => m.text.contains('依頼を破棄しました')), isTrue);
    });

    // PR #1473 再レビュー指摘 P2：次の依頼へ進むのが、欄の依頼を送ったときだけだった
    test('書きかけの文を送れたら、欄が空なら待っている依頼を欄に入れる', () async {
      notifier().setInput('書きかけ');
      notifier().receiveExternalDraft([createRequest]);
      expect(chat().activeExternalDraftId, isNull);

      await notifier().send();

      expect(assistant.routed, ['書きかけ']);
      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
      expect(chat().messages.last.text, contains('次の依頼を入力欄に入れました'));
    });

    test('書きかけの文を送れなかったときは、欄に戻った文を残し、依頼は待たせたまま', () async {
      notifier().setInput('書きかけ');
      notifier().receiveExternalDraft([createRequest]);
      assistant.failNext = true;

      await notifier().send();

      expect(chat().input, '書きかけ');
      expect(chat().activeExternalDraftId, isNull);
    });
  });

  group('相談（consult）に振り分けられた依頼', () {
    const task = RapiConsultTask(id: '7', title: '資料づくり');
    int pickerId() => chat().messages.lastWhere((m) => m.consultPicker != null).id;

    test('タスクを選ぶまでは、ほかの依頼を欄に入れても同じ依頼として取り込み直さない', () async {
      assistant.intent = 'consult';
      notifier().receiveExternalDraft([createRequest]);
      await notifier().send();

      expect(chat().input, isEmpty);
      expect(chat().activeExternalDraftId, isNull);
      expect(notifier().receiveExternalDraft([createRequest]), isFalse,
          reason: 'タスク選びを待っている依頼は受け取り済み');
    });

    test('「やめる」で閉じたら、依頼を欄に戻す（送るか破棄するまで消さない）', () async {
      assistant.intent = 'consult';
      notifier().receiveExternalDraft([createRequest]);
      await notifier().send();

      notifier().dismissConsultPicker(pickerId());

      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
    });

    test('相談を待つ間は次の依頼を欄に入れ、相談を送れたら相談した依頼だけを消す', () async {
      assistant.intent = 'consult';
      bridge.pending = [createRequest, offlineRequest];
      await container.read(pendingRequestIntakeProvider).pull(); // 保存先にも入る
      await notifier().send(); // offline が相談になる → 欄には次の create が入る
      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
      expect((await ExternalDraftInbox().load()).map((d) => d.id),
          containsAll([createRequest.id, offlineRequest.id]),
          reason: 'タスクを選ぶまでは、相談になった依頼も消さない');

      await notifier().chooseConsultTask(pickerId(), task);

      expect(assistant.consulted, [offlineRequest.text]);
      expect(chat().input, createRequest.text);
      expect(chat().activeExternalDraftId, createRequest.id);
      expect((await ExternalDraftInbox().load()).map((d) => d.id), [createRequest.id]);
    });
  });

  group('PendingRequestIntake', () {
    test('預かった依頼があれば下書きにして、入力欄にフォーカスした状態でラピを開く', () async {
      bridge.pending = [createRequest];
      final pulled = await container.read(pendingRequestIntakeProvider).pull();

      expect(pulled, isTrue);
      expect(chat().input, createRequest.text);
      expect(opened, 1);
      expect(assistant.routed, isEmpty);
    });

    test('預かった依頼がなければ画面を移らない', () async {
      final pulled = await container.read(pendingRequestIntakeProvider).pull();
      expect(pulled, isFalse);
      expect(opened, 0);
      expect(bridge.peeks, 1);
    });
  });

  group('PendingRapiRequest', () {
    test('ネイティブの値を読み、空の本文や形の違う値は捨てる', () {
      final r = PendingRapiRequest.tryParse({
        'id': 'n1',
        'text': ' 依頼 ',
        'createdAt': '2026-11-11T00:30:00Z',
        'reason': 'timeout',
      })!;
      expect(r.id, 'n1');
      expect(r.text, '依頼');
      expect(r.reason, 'timeout');
      expect(r.createdAt, DateTime.utc(2026, 11, 11, 0, 30));
      expect(PendingRapiRequest.tryParse({'text': '  '}), isNull);
      expect(PendingRapiRequest.tryParse('text'), isNull);
      expect(PendingRapiRequest.tryParse({'text': 'a'})!.reason, 'needs_confirmation');
    });

    test('保存用の形から同じ依頼に読み戻せる。番号がなければ中身から同じ番号を作る', () {
      final r = PendingRapiRequest.tryParse({
        'id': 'n1',
        'text': '依頼',
        'createdAt': '2026-11-11T00:30:00.000Z',
        'reason': 'offline',
      })!;
      final back = PendingRapiRequest.tryParse(r.toJson())!;
      expect([back.id, back.text, back.reason, back.createdAt], [r.id, r.text, r.reason, r.createdAt]);

      final a = PendingRapiRequest.tryParse({'text': 'x', 'createdAt': 't'})!;
      final b = PendingRapiRequest.tryParse({'text': 'x', 'createdAt': 't'})!;
      expect(a.id, b.id);
    });
  });
}
