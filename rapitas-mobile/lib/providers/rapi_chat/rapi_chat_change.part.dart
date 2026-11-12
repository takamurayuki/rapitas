// ラピの会話の処理のうち、変更（change）カード。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiChangeOps on _RapiChatBase {
  // ---- 変更（change）----
  // 文 → update-draft の提案カード → 「適用する」で task-update（confirmed: true）→
  // 「取り消す」で revert。カードのボタンが確認そのもので、確認なしに書き込む道は無い。

  @override
  Future<void> _runChangeDraft(String text) async {
    final draft = await ref.read(assistantServiceProvider).updateDraft(text);
    final proposal = draft.proposal;
    if (proposal == null) {
      // 対象や内容を特定できなかった。理由をラピの返信として出し、言い直してもらう
      final reasons = draft.unclear.length == 1
          ? draft.unclear.first
          : draft.unclear.map((u) => '・$u').join('\n');
      final window = draft.considered > 0 ? '（最近更新された${draft.considered}件の中から探しました）' : '';
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.assistant,
            text: '$reasons$window\n対象のタスク名と変えたい内容を添えて、もう一度送ってください。',
          ));
      return;
    }
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          change: RapiChangeCard(proposal: proposal, considered: draft.considered),
        ));
  }

  RapiChangeCard? _changeOf(int messageId) {
    for (final m in state.messages) {
      if (m.id == messageId) return m.change;
    }
    return null;
  }

  void _setChange(int messageId, RapiChangeCard change) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withChange(change) : m,
    ]);
  }

  @override
  void _refreshTask(String taskId) {
    ref.invalidate(taskListProvider);
    ref.invalidate(taskDetailProvider(taskId));
  }

  /// 「やめる」：確認待ちのカードを下げる（何も書き込んでいない）
  void cancelChange(int messageId) {
    if (_changeOf(messageId)?.phase != RapiChangePhase.proposed) return;
    state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList());
  }

  /// 「適用する」：カードに出ている変更をそのまま confirmed: true で送る
  Future<void> applyChange(int messageId) async {
    final card = _changeOf(messageId);
    if (card == null || card.phase != RapiChangePhase.proposed) return;
    _setChange(messageId, card.copyWith(phase: RapiChangePhase.applying, error: null));
    try {
      final result = await ref
          .read(assistantServiceProvider)
          .taskUpdate(card.proposal.taskId, card.proposal.changes);
      _refreshTask(card.proposal.taskId);
      _setChange(messageId,
          (_changeOf(messageId) ?? card).copyWith(phase: RapiChangePhase.applied, result: result));
    } catch (e) {
      final now = _changeOf(messageId) ?? card;
      if (_applyOutcomeUnknown(e)) {
        // 応答が失われただけで、サーバーでは適用済みのことがある。再適用（古い提案での
        // 上書き）を避けるため「適用する」は出さず、タスクを開いて確かめてもらう
        _refreshTask(card.proposal.taskId);
        _setChange(messageId, now.copyWith(phase: RapiChangePhase.applyUnknown, error: null));
        return;
      }
      _setChange(
          messageId, now.copyWith(phase: RapiChangePhase.proposed, error: _applyError(e)));
    }
  }

  /// 「取り消す」：適用した変更を元に戻す。後から別の編集が入った項目があれば（409）戻さない
  Future<void> revertChange(int messageId) async {
    final card = _changeOf(messageId);
    final result = card?.result;
    if (card == null || result == null || !card.canRevert) return;
    _setChange(messageId, card.copyWith(phase: RapiChangePhase.reverting, error: null));
    try {
      final reverted =
          await ref.read(assistantServiceProvider).revertTaskUpdate(result.actionId);
      final now = _changeOf(messageId) ?? card;
      if (reverted.reverted) {
        _refreshTask(card.proposal.taskId);
        _setChange(messageId, now.copyWith(phase: RapiChangePhase.reverted));
      } else {
        _setChange(messageId,
            now.copyWith(phase: RapiChangePhase.applied, conflicts: reverted.conflicts));
      }
    } catch (e) {
      if (e is AssistantException && e.code == 'no_undoable_update') {
        // 取り消せる記録がない（前回の取り消しが成功して応答だけ失われた等）。
        // 押し直しても同じなので、取り消しを終えた状態にしてボタンを下げる
        _refreshTask(card.proposal.taskId);
        _setChange(
            messageId,
            (_changeOf(messageId) ?? card)
                .copyWith(phase: RapiChangePhase.revertUnavailable, error: null));
        return;
      }
      final notFound = e is AssistantException && e.statusCode == 404;
      // サーバーはラピ経由で「完了」に戻すことを断る（完了の判定は完了ゲートと陪審が行う）
      final doneRefused = e is AssistantException && e.code == rapiDoneNotAllowedCode;
      _setChange(
        messageId,
        (_changeOf(messageId) ?? card).copyWith(
          phase: RapiChangePhase.applied,
          error: doneRefused
              ? '完了に戻す操作はラピからはできません。必要ならタスク画面から完了にしてください。'
              : notFound
              ? '元に戻せませんでした。タスクが見つかりません。'
              : e is AssistantTimeoutException
                  ? '応答がなく、元に戻せたか確かめられませんでした。タスクを開いて確認してください。'
                  : '元に戻せませんでした。もう一度試してください。',
        ),
      );
    }
  }

  static String _applyError(Object e) {
    if (e is AssistantTimeoutException) {
      return '応答がなく、変更できたか確かめられませんでした。タスクを開いて確認してください。';
    }
    if (e is AssistantException) {
      switch (e.code) {
        case 'not_found':
          return 'このタスクが見つかりませんでした。削除された可能性があります。';
        case 'theme_not_found':
          return '指定のテーマが見つかりませんでした。';
        case 'no_change':
          return 'すでにこの内容になっているため、変更はありませんでした。';
        case rapiDoneNotAllowedCode:
          return '完了にする操作はラピからはできません。完了はタスク画面から付けてください。';
      }
      if (e.statusCode == 400) return 'この変更内容は受け付けられませんでした。';
    }
    return 'うまくいきませんでした。もう一度試してください。';
  }

}

/// 適用の失敗が「書き込まれたか分からない」ものか。「適用されていない」と言い切れるのは、
/// サーバーが 4xx（400〜499）で断った・2xx で明示的に success:false を返した・送る前に弾いた
/// （invalid_task）・接続自体できなかった（connectionError / connectionTimeout）場合だけ。
/// それ以外（受信・送信タイムアウト、1xx・3xx・5xx、通信の途中切れ、応答の形が読めない
/// unexpected_response、想定外の例外）はすべて不明扱い。
/// 3xx はリダイレクト先で処理されたかもしれず、断られたとは言えない（commit の
/// [_commitOutcomeUnknown] と同じ線引き）。
bool _applyOutcomeUnknown(Object e) {
  if (e is AssistantException) {
    if (e.code == 'invalid_task') return false;
    final status = e.statusCode;
    if (status == null) return true;
    // 2xx の AssistantException は taskUpdate が明示的な success:false で投げたもの
    final rejected = (status >= 400 && status < 500) || (status >= 200 && status < 300);
    return !rejected;
  }
  if (e is AssistantTimeoutException) {
    return e.type != DioExceptionType.connectionTimeout;
  }
  if (e is DioException) {
    return e.type != DioExceptionType.connectionError;
  }
  return true;
}
