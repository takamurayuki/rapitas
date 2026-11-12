// ラピの会話の処理のうち、伴走（companion）カード。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiCompanionOps on _RapiChatBase {
  // ---- 伴走（companion）----
  // 「伴走」を含む発言 → companion/draft（何も書き込まない）→ 伴走の確認カード →
  // 「伴走を始める／やめる」で start/stop（confirmed: true）。カードのボタンが確認そのもので、
  // 確認なしに書き込む道は無い（task.update の変更カードと同じ型）。
  // 相談モードの外で対象が決まらないときは、タスク選びのカード（伴走用）を挟む。

  /// 発言が伴走の依頼なら確認カード（またはタスク選び）を出して true。そうでなければ false
  /// （呼び出し側がふつうの相談・振り分けへ送る）。下書きの問い合わせ自体が失敗したときも false
  /// （伴走の見分けは入口の付け足しなので、そこで送信全体を止めない）。
  @override
  Future<bool> _offerCompanion(String text,
      {String? consultTaskId, int? userId, String? externalDraftId}) async {
    if (!rapiMentionsCompanion(text)) return false;
    final RapiCompanionDraft draft;
    try {
      draft = await ref.read(assistantServiceProvider).companionDraft(text, taskId: consultTaskId);
    } catch (_) {
      return false;
    }
    if (!draft.matched) return false;
    if (draft.needsTask) {
      if (userId == null) return false;
      _system(draft.action == RapiCompanionAction.stop ? '伴走の終了として受け取りました' : '伴走の開始として受け取りました');
      _askConsultTask(text, userId, externalDraftId: externalDraftId, companion: draft.action);
      return true;
    }
    _showCompanion(draft, consultTaskId: consultTaskId);
    return true;
  }

  /// 伴走用のタスク選びカードでタスクを選んだ：そのタスクについて下書きを聞き、確認カードを出す
  @override
  Future<void> _chooseCompanionTask(
      int messageId, RapiConsultPicker picker, RapiConsultTask task) async {
    _setPicker(messageId, picker.copyWith(phase: RapiConsultPickPhase.chosen, chosen: task));
    state = state.copyWith(sending: true);
    try {
      final draft =
          await ref.read(assistantServiceProvider).companionDraft(picker.text, taskId: task.id);
      if (draft.matched) {
        _showCompanion(draft);
      } else {
        _system('伴走の依頼として読み取れませんでした。「伴走して」「伴走をやめて」と送ってください。');
      }
      if (picker.externalDraftId != null) await _consumeExternalDraft(picker.externalDraftId!);
    } catch (e) {
      _releaseExternalDraft(picker.externalDraftId);
      _system(e is AssistantTimeoutException ? rapiTimeoutMessage : '「${task.title}」の伴走の状態を確かめられませんでした');
    } finally {
      state = state.copyWith(sending: false);
    }
    _fillNextExternalDraft();
  }

  /// 下書きを、確認カードか「今は当てはまらない」理由の返事として並べる
  void _showCompanion(RapiCompanionDraft draft, {String? consultTaskId}) {
    final proposal = draft.proposal;
    if (proposal == null) {
      _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          text: '対象のタスクを確かめられませんでした。',
          consultTaskId: consultTaskId));
      return;
    }
    final unavailable = draft.unavailable;
    if (unavailable != null) {
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.assistant,
            text: rapiCompanionUnavailableText(unavailable, proposal.title),
            consultTaskId: consultTaskId,
          ));
      return;
    }
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          companion: RapiCompanionCard(proposal: proposal),
          consultTaskId: consultTaskId,
        ));
  }

  RapiCompanionCard? _companionOf(int messageId) {
    for (final m in state.messages) {
      // 読み込んだ記録（archived）のカードは読み取り専用。ここで引けなくして、全ての操作を止める（設計 nav39 5.3.1）
      if (m.id == messageId) return m.archived ? null : m.companion;
    }
    return null;
  }

  void _setCompanion(int messageId, RapiCompanionCard card) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withCompanion(card) : m,
    ]);
  }

  /// 「やめる」：確認待ちの伴走カードを下げる（何も書き込んでいない）
  void cancelCompanion(int messageId) {
    if (_companionOf(messageId)?.phase != RapiCompanionPhase.proposed) return;
    state = state.copyWith(messages: state.messages.where((m) => m.id != messageId).toList());
  }

  /// 「伴走を始める／やめる」：カードに出ている内容をそのまま confirmed: true で送る
  Future<void> applyCompanion(int messageId) async {
    final card = _companionOf(messageId);
    if (card == null || card.phase != RapiCompanionPhase.proposed) return;
    _setCompanion(messageId, card.copyWith(phase: RapiCompanionPhase.applying, error: null));
    final p = card.proposal;
    try {
      await ref.read(assistantServiceProvider).companionApply(p.action, p.taskId);
      _refreshTask(p.taskId);
      _setCompanion(
          messageId, (_companionOf(messageId) ?? card).copyWith(phase: RapiCompanionPhase.applied));
    } catch (e) {
      final now = _companionOf(messageId) ?? card;
      if (_applyOutcomeUnknown(e)) {
        _setCompanion(messageId, now.copyWith(phase: RapiCompanionPhase.applyUnknown, error: null));
        return;
      }
      final code = e is AssistantException ? e.code : null;
      // 既にその状態になっていた（別の画面や前の押下で反映済み）なら、望んだ結果になっている
      final settled = (p.action == RapiCompanionAction.start && code == 'already_active') ||
          (p.action == RapiCompanionAction.stop && code == 'not_active');
      if (settled) {
        _setCompanion(messageId, now.copyWith(phase: RapiCompanionPhase.applied));
        return;
      }
      _setCompanion(
        messageId,
        now.copyWith(
          phase: RapiCompanionPhase.proposed,
          error: code == 'task_done'
              ? 'このタスクは完了しているため、伴走は始められません。'
              : code == 'task_not_found' || code == 'not_found'
                  ? 'このタスクが見つかりませんでした。削除された可能性があります。'
                  : 'うまくいきませんでした。もう一度試してください。',
        ),
      );
    }
  }

}
