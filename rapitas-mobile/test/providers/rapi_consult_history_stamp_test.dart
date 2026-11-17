import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_chat_message.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_read_mark.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// 相談の履歴を読み直したとき、ラピの返答が続く発言には相談の印（👌）を付け、返答の無い末尾の
// 発言には付けない（nav63 レビュー指摘 P2）。

/// 相談に振り分け、[past] を過去の相談として返す
class _HistoryAssistant implements AssistantService {
  _HistoryAssistant(this.past);

  final List<CopilotHistoryMessage> past;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent(intent: 'consult');

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async => past;

  @override
  Future<CopilotReply> copilotChat(String message,
          {required String taskId, List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: '今回の返事');

  @override
  Future<RapiCompanionDraft> companionDraft(String text, {String? taskId}) async =>
      const RapiCompanionDraft(matched: false);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('rapiConsultHistoryReadAs', () {
    test('返答が続くユーザー行だけ相談の印。末尾・連続するユーザー行・ラピの行には付けない', () {
      expect(rapiConsultHistoryReadAs([true, false, true, true, false, true]),
          [rapiIntentConsult, null, null, rapiIntentConsult, null, null]);
    });

    test('空の履歴は空', () {
      expect(rapiConsultHistoryReadAs(const []), isEmpty);
    });
  });

  test('相談の履歴を読み込むと、返答済みの発言に印が付き、未回答の末尾には付かない', () async {
    CopilotHistoryMessage line(String id, bool fromUser, String content) =>
        CopilotHistoryMessage(id: id, fromUser: fromUser, content: content);
    final container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(_HistoryAssistant([
        line('1', true, '前に聞いたこと'),
        line('2', false, '前の返事'),
        line('3', true, '返事の来なかったこと'),
      ])),
    ]);
    addTearDown(container.dispose);
    final chat = container.read(rapiChatProvider.notifier);

    chat.setInput('このタスクについて相談したい');
    await chat.send();
    final picker =
        container.read(rapiChatProvider).messages.firstWhere((m) => m.consultPicker != null);
    await chat.chooseConsultTask(picker.id, const RapiConsultTask(id: '7', title: '設計書を書く'));

    String? readOf(String text) => container
        .read(rapiChatProvider)
        .messages
        .firstWhere((m) => m.role == RapiRole.user && m.text == text)
        .readAs;
    expect(readOf('前に聞いたこと'), rapiIntentConsult);
    expect(readOf('返事の来なかったこと'), isNull);
    // 保留していた今回の発言は、振り分けで読み取った印のまま
    expect(readOf('このタスクについて相談したい'), rapiIntentConsult);
  });
}
