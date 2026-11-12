import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_spaces_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/rapi_chat_space_service.dart';

import 'rapi_space_fakes.dart';

// 会話スペースの provider テストの土台（nav39）。アプリの1回の起動を1つの ProviderContainer で表し、
// 端末の保存先（[prefs]）とサーバー（[server]）は起動をまたいで同じものを使う。

class SpaceApp {
  final FakeSpaceServer server;
  final Map<String, String> prefs;
  final FakeAssistant assistant;
  final ManualScheduler clock = ManualScheduler();
  late final ProviderContainer c;

  /// [serviceOf] を渡すと、接続先ごとに別のサーバーを返せる（既定はいつも [server]）
  SpaceApp(this.server, this.prefs,
      {FakeAssistant? assistant,
      List<Override> extra = const [],
      RapiChatSpaceService Function(Ref ref)? serviceOf})
      : assistant = assistant ?? FakeAssistant() {
    c = ProviderContainer(overrides: [
      ...extra,
      assistantServiceProvider.overrideWithValue(this.assistant),
      rapiChatSpaceServiceProvider.overrideWith(serviceOf ?? (_) => server),
      rapiSaveStoreFactoryProvider.overrideWithValue((key) => MemoryStore(prefs, key)),
      rapiSaveSchedulerProvider.overrideWithValue(clock.call),
    ]);
  }

  RapiChatNotifier get chat => c.read(rapiChatProvider.notifier);
  RapiChatState get chatState => c.read(rapiChatProvider);
  RapiChatSpacesNotifier get spaces => c.read(rapiChatSpacesProvider.notifier);
  RapiSpacesState get spacesState => c.read(rapiChatSpacesProvider);

  /// 起動する（最後に開いたスペースを開くまで待つ）
  Future<SpaceApp> start() async {
    await spaces.start();
    await settle();
    return this;
  }

  /// 0.5秒のまとめと、続く保存を終わらせる
  Future<void> settle() async {
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    clock.runAll();
    await spaces.queue?.flush();
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> say(String text) async {
    chat.setInput(text);
    await chat.send();
    await settle();
  }

  /// 画面の発言（挨拶を除く）の [本文]
  List<String> get texts => [
        for (final m in chatState.messages)
          if (!m.localOnly) m.text,
      ];

  void dispose() => c.dispose();
}

/// サーバーのスペースの行の本文（保存された順）
List<String> rowTexts(FakeSpace s) => [for (final r in s.rows) r.text];

/// 送信に失敗した印などを含む行の形
String rowShape(SavedMessage r) => '${r.role}:${r.text}:${r.inHistory}';
