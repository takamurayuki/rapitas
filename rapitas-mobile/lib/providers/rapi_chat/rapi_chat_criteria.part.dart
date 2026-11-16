// ラピの会話の処理のうち、完了条件の変更（criteria）カード（設計 段E・§7 第2段階 項目3）。
//
// NOTE: 会話スペース v1（#1488）の provider 分割に合わせ、バッチB（1e3bd094）で一枚岩の
// rapi_chat_provider.dart に足していた処理をここへ移した。挙動は変えていない。足したのは、
// 読み込んだ記録（archived）のカードを引けなくする行だけ（他のカードと同じ読み取り専用の扱い）。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiCriteriaOps on _RapiChatBase {
  // ---- 完了条件の変更（段E）----
  // 相談中のタスクで「完了条件を変える」→ 今の条件を直すカード →「下書きを作る」で criteria-draft
  // （書き込まない）→ 差分と理由を確かめて「この内容で確定」で task-criteria（confirmed: true と
  // 下書きの版）→「取り消す」で revert。カードのボタンが確認そのもので、確認なしに書き込む道は無い。
  // 版がずれていた（criteria_changed_since）ら、最新の条件から作り直してもらう。
  // NOTE: これはラピの capability（task.criteria-*）の呼び出しで、判断の受け口（HumanDecisionClient・
  // X-Rapitas-Source）は使わない（バッチAの判断の境界はそのまま）。

  /// [taskId] の完了条件を直すカードを出す。今の条件はタスクから読む
  Future<void> openCriteriaChange(String taskId, String title,
      {String reason = '', String? error}) async {
    try {
      ref.invalidate(taskDetailProvider(taskId));
      final task = await ref.read(taskDetailProvider(taskId).future);
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.assistant,
            criteria: RapiCriteriaCard.start(
                taskId: taskId,
                title: task.title.isNotEmpty ? task.title : title,
                criteria: task.acceptanceCriteria,
                reason: reason,
                error: error),
          ));
    } catch (_) {
      _system('「$title」の今の完了条件を読めませんでした。少し待ってからもう一度試してください。');
    }
  }

  RapiCriteriaCard? _criteriaOf(int messageId) {
    for (final m in state.messages) {
      // 読み込んだ記録（archived）のカードは読み取り専用。ここで引けなくして、全ての操作を止める（設計 nav39 5.3.1）
      if (m.id == messageId) return m.archived ? null : m.criteria;
    }
    return null;
  }

  void _setCriteria(int messageId, RapiCriteriaCard card) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withCriteria(card) : m,
    ]);
  }

  void _editCriteria(int messageId, RapiCriteriaEdit Function(RapiCriteriaEdit) change) {
    final card = _criteriaOf(messageId);
    if (card == null || card.phase != RapiCriteriaPhase.editing) return;
    _setCriteria(messageId, card.copyWith(edit: change(card.edit).settled(), error: null));
  }

  /// 条件を外す／戻す
  void toggleCriteriaItem(int messageId, int index) =>
      _editCriteria(messageId, (e) => e.toggled(index));

  /// 条件の文を直す（言い換え）
  void editCriteriaItem(int messageId, int index, String text) =>
      _editCriteria(messageId, (e) => e.rewritten(index, text));

  /// 条件を足す
  void addCriteriaItem(int messageId, String text) =>
      _editCriteria(messageId, (e) => e.appended(text));

  /// 変える理由（カードの欄から）
  void setCriteriaReason(int messageId, String reason) {
    final card = _criteriaOf(messageId);
    if (card == null || card.phase != RapiCriteriaPhase.editing || card.reason == reason) return;
    _setCriteria(messageId, card.copyWith(reason: reason));
  }

  /// 「やめる」：書き込む前のカードを下げる
  void cancelCriteriaChange(int messageId) {
    final phase = _criteriaOf(messageId)?.phase;
    if (phase != RapiCriteriaPhase.editing && phase != RapiCriteriaPhase.proposed) return;
    state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList());
  }

  /// 「下書きを作る」：直した条件で criteria-draft を呼ぶ（書き込まない）
  Future<void> draftCriteriaChange(int messageId) async {
    final card = _criteriaOf(messageId);
    if (card == null || !card.canDraft) return;
    _setCriteria(messageId, card.copyWith(phase: RapiCriteriaPhase.drafting, error: null));
    try {
      final draft = await ref.read(assistantServiceProvider).criteriaDraft(card.taskId,
          acceptanceCriteria: card.proposed, reason: card.reason.trim());
      _setCriteria(
          messageId,
          (_criteriaOf(messageId) ?? card)
              .copyWith(phase: RapiCriteriaPhase.proposed, draft: draft, refusal: null));
    } catch (e) {
      _setCriteria(
          messageId,
          (_criteriaOf(messageId) ?? card).copyWith(
            phase: RapiCriteriaPhase.editing,
            error: e is AssistantTimeoutException
                ? '応答がなく、下書きを作れませんでした。もう一度試してください。'
                : e is AssistantException && e.statusCode == 404
                    ? 'このタスクが見つかりませんでした。削除された可能性があります。'
                    : '下書きを作れませんでした。もう一度試してください。',
          ));
    }
  }

  /// 「直す」：差分の確認から、条件を直す欄へ戻る（まだ何も書き込んでいない）
  void backToCriteriaEdit(int messageId) {
    final card = _criteriaOf(messageId);
    if (card == null || card.phase != RapiCriteriaPhase.proposed) return;
    _setCriteria(messageId,
        card.copyWith(phase: RapiCriteriaPhase.editing, draft: null, refusal: null, error: null));
  }

  /// 「最新の条件で作り直す」：版がずれて断られたカードを下げ、今の条件から直し直すカードを出す。
  /// 書いた理由は引き継ぐ（何を変えたかったかは、今の条件を見てもう一度直してもらう）
  Future<void> rebuildCriteriaChange(int messageId) async {
    final card = _criteriaOf(messageId);
    if (card == null || card.refusal != 'criteria_changed_since') return;
    state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList());
    await openCriteriaChange(card.taskId, card.title,
        reason: card.reason, error: '最新の完了条件を読み直しました。変えたい点を、もう一度直してください。');
  }

  /// 409 の理由を、カードに出す文にする（サーバーの文があればそれを使う）
  static String _criteriaRefusalText(AssistantException e) {
    switch (e.code) {
      case 'criteria_changed_since':
        return 'この下書きを作ったあとで、完了条件が変わりました。古い内容で上書きしないよう、'
            '確定を止めました。最新の条件から下書きを作り直してください。';
      case 'review_in_progress':
        return e.message ??
            'いまは陪審が確認中（またはレビュー保留・確認済み）なので、完了条件は変えられません。終わってから変えましょう。';
      case 'task_done':
        return e.message ?? '完了したタスクの完了条件は変えられません。足りない点は追加のタスクにしてください。';
      case 'no_change':
        return 'すでにこの内容になっているため、変更はありませんでした。';
    }
    return e.message ?? '変えられませんでした。';
  }

  static const _criteriaRefusals = {
    'criteria_changed_since',
    'review_in_progress',
    'task_done',
    'no_change',
  };

  /// 「この内容で確定」：下書きをそのまま、下書きの版を付けて送る
  Future<void> applyCriteriaChange(int messageId) async {
    final card = _criteriaOf(messageId);
    final draft = card?.draft;
    if (card == null || draft == null || !card.canApply) return;
    _setCriteria(messageId, card.copyWith(phase: RapiCriteriaPhase.applying, error: null));
    try {
      final result = await ref.read(assistantServiceProvider).criteriaUpdate(draft);
      _refreshTask(card.taskId);
      _setCriteria(messageId,
          (_criteriaOf(messageId) ?? card).copyWith(phase: RapiCriteriaPhase.applied, result: result));
    } catch (e) {
      final now = _criteriaOf(messageId) ?? card;
      if (e is AssistantException && _criteriaRefusals.contains(e.code)) {
        _setCriteria(
            messageId,
            now.copyWith(
                phase: RapiCriteriaPhase.proposed,
                refusal: e.code,
                error: _criteriaRefusalText(e)));
        return;
      }
      if (_applyOutcomeUnknown(e)) {
        _refreshTask(card.taskId);
        _setCriteria(messageId, now.copyWith(phase: RapiCriteriaPhase.applyUnknown, error: null));
        return;
      }
      _setCriteria(
          messageId,
          now.copyWith(
            phase: RapiCriteriaPhase.proposed,
            error: e is AssistantException && e.statusCode == 404
                ? 'このタスクが見つかりませんでした。削除された可能性があります。'
                : 'うまくいきませんでした。もう一度試してください。',
          ));
    }
  }

  /// 「取り消す」：確定した変更を元に戻す。その後に条件が変わっていれば（409）戻さない
  Future<void> revertCriteriaChange(int messageId) async {
    final card = _criteriaOf(messageId);
    final result = card?.result;
    if (card == null || result == null || !card.canRevert) return;
    _setCriteria(messageId, card.copyWith(phase: RapiCriteriaPhase.reverting, error: null));
    try {
      await ref.read(assistantServiceProvider).revertCriteria(result.actionId);
      _refreshTask(card.taskId);
      _setCriteria(
          messageId, (_criteriaOf(messageId) ?? card).copyWith(phase: RapiCriteriaPhase.reverted));
    } catch (e) {
      final now = _criteriaOf(messageId) ?? card;
      if (e is AssistantException && e.code == 'no_undoable_criteria_change') {
        _refreshTask(card.taskId);
        _setCriteria(
            messageId, now.copyWith(phase: RapiCriteriaPhase.revertUnavailable, error: null));
        return;
      }
      final refused = e is AssistantException && _criteriaRefusals.contains(e.code);
      _setCriteria(
          messageId,
          now.copyWith(
            phase: RapiCriteriaPhase.applied,
            refusal: refused ? e.code : null,
            error: refused && e.code == 'criteria_changed_since'
                ? 'その後に完了条件が変わったため、元に戻しませんでした。今の条件はタスクを開いて確かめてください。'
                : refused
                    ? _criteriaRefusalText(e)
                    : e is AssistantTimeoutException
                        ? '応答がなく、元に戻せたか確かめられませんでした。タスクを開いて確認してください。'
                        : '元に戻せませんでした。もう一度試してください。',
          ));
    }
  }
}
