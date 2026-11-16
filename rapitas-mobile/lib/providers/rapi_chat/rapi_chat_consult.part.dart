// ラピの会話の処理のうち、相談（consult）とタスク選び。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiConsultOps on _RapiChatBase {
  // ---- 相談（consult）----
  // 振り分けが consult → 「どのタスクについて相談しますか」カード → タスクを選ぶと相談モードに入り、
  // そのタスクの過去の相談を読み込んでから、保留していた発言を最初の相談として送る。
  // 相談モード中の送信は振り分けを通さず copilot/chat（taskId 付き・履歴はそのタスクのスレッド分）へ。
  // 画面の帯の × で抜けると、通常の振り分けに戻る。

  /// 発言 [text] を保留し、タスク選びのカードを出す（発言はまだどこにも送らない）
  @override
  void _askConsultTask(String text, int userId,
      {String? externalDraftId, RapiCompanionAction? companion}) {
    if (externalDraftId != null) _holdExternalDraft(externalDraftId);
    // 保留した発言は一般の会話の履歴に入れない（選んだあと相談スレッドへ移す）
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == userId ? m.withoutHistory() : m,
    ]);
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          consultPicker: RapiConsultPicker(
              text: text,
              utteranceId: userId,
              externalDraftId: externalDraftId,
              companion: companion),
        ));
  }

  RapiConsultPicker? _pickerOf(int messageId) {
    for (final m in state.messages) {
      if (m.id == messageId) return m.consultPicker;
    }
    return null;
  }

  @override
  void _setPicker(int messageId, RapiConsultPicker picker) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withConsultPicker(picker) : m,
    ]);
  }

  @override
  void _closePendingPickers() {
    final open = [
      for (final m in state.messages)
        if (m.consultPicker?.phase == RapiConsultPickPhase.choosing) m.consultPicker!,
    ];
    if (open.isEmpty) return;
    // 閉じたカードの依頼は送らないので待ち行列へ戻す（この送信が終わって欄が空けば欄に入る）
    for (final p in open) {
      _releaseExternalDraft(p.externalDraftId);
    }
    state = state.copyWith(messages: [
      for (final m in state.messages)
        m.consultPicker?.phase == RapiConsultPickPhase.choosing
            ? m.withConsultPicker(m.consultPicker!.copyWith(phase: RapiConsultPickPhase.closed))
            : m,
    ]);
  }

  /// タスク選びカードの「やめる」：選ばずに閉じる（保留した発言は送らない）
  void dismissConsultPicker(int messageId) {
    final picker = _pickerOf(messageId);
    if (picker == null || picker.phase != RapiConsultPickPhase.choosing) return;
    _setPicker(messageId, picker.copyWith(phase: RapiConsultPickPhase.closed));
    // 依頼は送らなかったので消さずに戻す（欄が空なら欄に入れる。消すのは送ったとき・破棄したときだけ）
    _releaseExternalDraft(picker.externalDraftId);
    _fillNextExternalDraft();
  }

  /// タスク選びカードでタスクを選んだ：相談モードに入り、保留していた発言を送る
  Future<void> chooseConsultTask(int messageId, RapiConsultTask task) async {
    final picker = _pickerOf(messageId);
    if (picker == null || picker.phase != RapiConsultPickPhase.choosing || state.sending) {
      return;
    }
    if (picker.companion != null) return _chooseCompanionTask(messageId, picker, task);
    _setPicker(messageId, picker.copyWith(phase: RapiConsultPickPhase.chosen, chosen: task));
    state = state.copyWith(consultTask: task, sending: true);
    final session = ++_consultSession;
    var userId = picker.utteranceId;
    final draftId = picker.externalDraftId;
    var sent = false;
    var refilled = false;
    try {
      await _loadConsultThread(task, session);
      // 履歴を待つ間に相談を終えていたら（帯の ×）、保留していた発言は送らず、何も並べない
      if (session != _consultSession) {
        _releaseExternalDraft(draftId);
        _fillNextExternalDraft();
        return;
      }
      // 保留していた発言を、読み込んだ履歴のあと（相談スレッドの末尾）へ移してから送る
      final history = _consultHistory(task.id);
      userId = _nextId;
      state = state.copyWith(
          messages: state.messages.where((m) => m.id != picker.utteranceId).toList());
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.user,
            text: picker.text,
            inHistory: true,
            consultTaskId: task.id,
          ));
      await _sendConsult(task, picker.text, history);
      sent = true;
    } catch (e) {
      refilled = state.input.trim().isEmpty;
      _sendFailed(e, picker.text, userId);
    } finally {
      state = state.copyWith(sending: false);
    }
    if (sent) {
      if (draftId != null) await _consumeExternalDraft(draftId);
      _fillNextExternalDraft();
    } else {
      _releaseExternalDraft(draftId, refilled: refilled);
    }
  }

  /// このタスクの過去の相談をスレッドに出す。この会話にもうスレッドがあればそれを使う
  /// （出し直すと同じやりとりが二重に並ぶため）。読めなくても相談は続ける（デスクトップと同じ）
  /// [session] は呼び出し時の相談の世代。読み込みを待つ間に相談が終わっていたら何も並べない
  Future<void> _loadConsultThread(RapiConsultTask task, int session) async {
    if (state.messages.any((m) => m.consultTaskId == task.id && m.inHistory)) return;
    final List<CopilotHistoryMessage> past;
    try {
      past = await ref.read(assistantServiceProvider).copilotHistory(task.id);
    } catch (_) {
      if (session != _consultSession) return;
      _system('「${task.title}」のこれまでの相談を読み込めませんでした');
      return;
    }
    if (session != _consultSession || past.isEmpty) return;
    _system('「${task.title}」のこれまでの相談（${past.length}件）');
    for (final p in past) {
      _add((id) => RapiMessage(
            id: id,
            role: p.fromUser ? RapiRole.user : RapiRole.assistant,
            text: p.content,
            inHistory: true,
            consultTaskId: task.id,
          ));
    }
  }

  @override
  Future<void> _sendConsult(
      RapiConsultTask task, String text, List<Map<String, String>> history) async {
    final reply = await ref
        .read(assistantServiceProvider)
        .copilotChat(text, taskId: task.id, history: history);
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          text: reply.content,
          inHistory: true,
          consultTaskId: task.id,
        ));
  }

  /// 相談モードを抜ける（帯の ×）。以降の送信は通常の振り分けに戻る
  void exitConsult() {
    final task = state.consultTask;
    if (task == null) return;
    _consultSession++;
    state = state.copyWith(consultTask: null);
    _system('「${task.title}」の相談を終えました');
  }

}
