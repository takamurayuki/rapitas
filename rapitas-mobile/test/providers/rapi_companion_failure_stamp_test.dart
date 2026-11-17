import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_chat_message.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_read_mark.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_decode.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

// 伴走のタスク選びの後で失敗したら、送信時に付けた確認の印（🫡）を元の発言から外す。
// 保存して読み直しても、失敗した発言として印を戻さない（nav63 レビュー指摘 P2）。

/// 対象なしの「伴走して」にはタスク選びを求め、タスクを選んだ後の下書きは [failWith] で失敗させる
class _FailingCompanionAssistant implements AssistantService {
  _FailingCompanionAssistant(this.failWith);

  final Object failWith;

  @override
  Future<RapiCompanionDraft> companionDraft(String text, {String? taskId}) async {
    if (taskId == null) {
      return const RapiCompanionDraft(
          matched: true, action: RapiCompanionAction.start, needsTask: true);
    }
    throw failWith;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  const said = '伴走して';
  const task = RapiConsultTask(id: '7', title: 'ログインのバグを直す');

  final cases = <String, (Object, String)>{
    'タイムアウト': (const AssistantTimeoutException(DioExceptionType.receiveTimeout), rapiTimeoutMessage),
    '通常のエラー': (Exception('network'), rapiSendFailedText),
  };

  for (final MapEntry(key: name, value: (error, notice)) in cases.entries) {
    test('タスクを選んだ後の下書きが$nameで失敗：印を外し、読み直しでも戻さない', () async {
      final container = ProviderContainer(overrides: [
        assistantServiceProvider.overrideWithValue(_FailingCompanionAssistant(error)),
      ]);
      addTearDown(container.dispose);
      final chat = container.read(rapiChatProvider.notifier);
      RapiMessage utterance() => container
          .read(rapiChatProvider)
          .messages
          .firstWhere((m) => m.role == RapiRole.user && m.text == said);

      chat.setInput(said);
      await chat.send();
      // タスク選びを出した時点で伴走の依頼として読み取っている
      expect(utterance().readAs, rapiIntentCompanion);
      final picker =
          container.read(rapiChatProvider).messages.firstWhere((m) => m.consultPicker != null);

      await chat.chooseConsultTask(picker.id, task);

      final messages = container.read(rapiChatProvider).messages;
      expect(utterance().readAs, isNull);
      expect(messages.last.role, RapiRole.system);
      expect(messages.last.text, notice);
      // 共通の失敗処理と同じく、送れなかった文は欄に戻る
      expect(container.read(rapiChatProvider).input, said);

      // 保存して読み直す（印は保存しないので、記録から戻す）
      var n = 0;
      final reloaded = rapiRestoreReadMarks([
        for (final m in messages.where(rapiShouldSave))
          if (encodeRapiMessage(m, clientId: 'c${n++}') case final saved?)
            decodeSavedMessage(saved, id: n),
      ]);
      final restored = reloaded.firstWhere((m) => m.role == RapiRole.user && m.text == said);
      expect(restored.archived, isTrue);
      expect(restored.readAs, isNull);
    });
  }
}
