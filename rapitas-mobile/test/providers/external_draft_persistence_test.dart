import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/pending_request_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/external_draft_inbox.dart';
import 'package:rapitas_mobile/services/home_screen_bridge.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../support/home_screen_fakes.dart';

/// ショートカットから届いた依頼が、送るか破棄するまでアプリの再起動をまたいで残ること
/// （PR #1473 レビュー指摘 P1：取り出してすぐ消していたので、未送信のまま終えると失われた）。
///
/// 「再起動」は ProviderContainer を作り直して表す（チャットの状態は消え、SharedPreferences だけが残る）。

/// 保存に失敗する保存先
class _FailingInbox extends ExternalDraftInbox {
  @override
  Future<List<PendingRapiRequest>> addAll(List<PendingRapiRequest> requests) async =>
      throw StateError('disk full');

  @override
  Future<List<PendingRapiRequest>> load() async => const [];
}

/// ack の時点で、依頼がもう保存先にあるかを記録する
class _OrderCheckingBridge extends FakeHomeScreenBridge {
  final List<bool> savedBeforeAck = [];

  @override
  Future<void> ackPendingRequests(List<String> ids) async {
    final raw = (await SharedPreferences.getInstance()).getString(ExternalDraftInbox.draftsKey) ?? '[]';
    final saved = {for (final d in jsonDecode(raw) as List) (d as Map)['id']};
    savedBeforeAck.add(ids.every(saved.contains));
    await super.ackPendingRequests(ids);
  }
}

void main() {
  late FakeAssistant assistant;
  final containers = <ProviderContainer>[];

  /// アプリを起動する（同じ SharedPreferences を使う、新しいプロセスの代わり）
  ProviderContainer launch(HomeScreenBridge bridge, {ExternalDraftInbox? inbox}) {
    final c = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
      homeScreenBridgeProvider.overrideWithValue(bridge),
      rapiComposeOpenerProvider.overrideWithValue(() {}),
      if (inbox != null) externalDraftInboxProvider.overrideWithValue(inbox),
    ]);
    containers.add(c);
    return c;
  }

  Future<bool> pull(ProviderContainer c) => c.read(pendingRequestIntakeProvider).pull();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    assistant = FakeAssistant();
  });
  tearDown(() {
    for (final c in containers) {
      c.dispose();
    }
    containers.clear();
  });

  test('取り込んだ依頼を送らずに終えても、次の起動で入力欄に戻る', () async {
    final native = FakeHomeScreenBridge()..pending = [createRequest];
    final first = launch(native);
    expect(await pull(first), isTrue);
    expect(native.pending, isEmpty, reason: 'アプリ側に保存できたのでネイティブ側は消した');
    first.dispose(); // 送らずにアプリを終える

    final second = launch(FakeHomeScreenBridge());
    expect(await pull(second), isTrue);
    expect(second.read(rapiChatProvider).input, createRequest.text);
    expect(second.read(rapiChatProvider).activeExternalDraftId, createRequest.id);
  });

  test('欄に入れず一覧に並べただけの依頼も、次の起動で戻る', () async {
    final first = launch(FakeHomeScreenBridge()..pending = [createRequest, offlineRequest]);
    await pull(first);
    first.dispose();

    final second = launch(FakeHomeScreenBridge());
    await pull(second);
    final text = second.read(rapiChatProvider).messages.last.text;
    expect(second.read(rapiChatProvider).input, offlineRequest.text);
    expect(text, contains('・${createRequest.text}'));
  });

  test('送れた依頼と破棄した依頼は、次の起動で戻らない', () async {
    final first = launch(FakeHomeScreenBridge()..pending = [createRequest, offlineRequest]);
    await pull(first);
    await first.read(rapiChatProvider.notifier).send(); // offline を送る → create が欄に入る
    await first.read(rapiChatProvider.notifier).discardExternalDraft(); // create を破棄
    first.dispose();

    final second = launch(FakeHomeScreenBridge());
    expect(await pull(second), isFalse);
    expect(second.read(rapiChatProvider).input, isEmpty);
    expect(await ExternalDraftInbox().load(), isEmpty);
  });

  test('送れなかった依頼は残り、次の起動で戻る', () async {
    final first = launch(FakeHomeScreenBridge()..pending = [createRequest]);
    await pull(first);
    assistant.failNext = true;
    await first.read(rapiChatProvider.notifier).send();
    first.dispose();

    final second = launch(FakeHomeScreenBridge());
    expect(await pull(second), isTrue);
    expect(second.read(rapiChatProvider).input, createRequest.text);
  });

  test('ネイティブ側は、アプリ側に保存し終えてから消す', () async {
    final native = _OrderCheckingBridge()..pending = [createRequest];
    await pull(launch(native));
    expect(native.savedBeforeAck, [true]);
  });

  test('アプリ側に保存できなければネイティブ側は消さず、下書きには入れる', () async {
    final native = FakeHomeScreenBridge()..pending = [createRequest];
    final c = launch(native, inbox: _FailingInbox());
    expect(await pull(c), isTrue);
    expect(c.read(rapiChatProvider).input, createRequest.text);
    expect(native.acked, isEmpty);
    expect(native.pending.map((r) => r.id), [createRequest.id]);
  });

  test('ネイティブ側の消去が届かず同じ依頼をまた読んでも、送り終えた依頼は戻らない', () async {
    final first = launch(FakeHomeScreenBridge()..pending = [createRequest]);
    await pull(first);
    await first.read(rapiChatProvider.notifier).send();
    first.dispose();

    final second = launch(FakeHomeScreenBridge()..pending = [createRequest]);
    expect(await pull(second), isFalse);
  });

  // PR #1473 再レビュー指摘 P1：consult はタスク選びカードを出すだけで、本文はまだ送っていない。
  // 送信が例外なく戻った時点で消していたので、タスクを選ばずに終えると依頼が失われた。
  group('相談（consult）に振り分けられた依頼', () {
    const task = RapiConsultTask(id: '7', title: '資料づくり');

    int pickerId(ProviderContainer c) =>
        c.read(rapiChatProvider).messages.lastWhere((m) => m.consultPicker != null).id;

    test('タスクを選ばずにアプリを終えても、次の起動で入力欄に戻る', () async {
      assistant.intent = 'consult';
      final first = launch(FakeHomeScreenBridge()..pending = [createRequest]);
      await pull(first);
      await first.read(rapiChatProvider.notifier).send();
      expect(first.read(rapiChatProvider).messages.any((m) => m.consultPicker != null), isTrue);
      expect(assistant.consulted, isEmpty, reason: '本文はまだ送っていない');
      first.dispose(); // タスクを選ばずに終える

      final second = launch(FakeHomeScreenBridge());
      expect(await pull(second), isTrue);
      expect(second.read(rapiChatProvider).input, createRequest.text);
      expect(second.read(rapiChatProvider).activeExternalDraftId, createRequest.id);
    });

    test('タスクを選んだあと相談の送信に失敗したら、欄に戻り、次の起動でも戻る', () async {
      assistant.intent = 'consult';
      final first = launch(FakeHomeScreenBridge()..pending = [createRequest]);
      await pull(first);
      final notifier = first.read(rapiChatProvider.notifier);
      await notifier.send();
      assistant.failConsult = true;
      await notifier.chooseConsultTask(pickerId(first), task);
      expect(first.read(rapiChatProvider).input, createRequest.text);
      expect(first.read(rapiChatProvider).activeExternalDraftId, createRequest.id,
          reason: '欄に戻った文は、まだショートカットの依頼のまま（送れたら消す・破棄できる）');
      first.dispose();

      final second = launch(FakeHomeScreenBridge());
      expect(await pull(second), isTrue);
      expect(second.read(rapiChatProvider).input, createRequest.text);
    });

    test('タスクを選んで相談を送れたら消し、次の起動で戻らない', () async {
      assistant.intent = 'consult';
      final first = launch(FakeHomeScreenBridge()..pending = [createRequest]);
      await pull(first);
      final notifier = first.read(rapiChatProvider.notifier);
      await notifier.send();
      await notifier.chooseConsultTask(pickerId(first), task);
      expect(assistant.consulted, [createRequest.text]);
      first.dispose();

      final second = launch(FakeHomeScreenBridge()..pending = [createRequest]);
      expect(await pull(second), isFalse);
      expect(await ExternalDraftInbox().load(), isEmpty);
    });
  });

  test('同じ起動の中で何度取り込んでも、同じ依頼は1度だけ', () async {
    final native = FakeHomeScreenBridge()..pending = [createRequest];
    final c = launch(native);
    expect(await pull(c), isTrue);
    native.pending = [createRequest]; // 消去が届かなかった
    expect(await pull(c), isFalse);
    expect(await ExternalDraftInbox().load(), hasLength(1));
  });
}
