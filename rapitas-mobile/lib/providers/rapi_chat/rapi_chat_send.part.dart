// ラピの会話の処理のうち、送信と振り分け。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiSendOps on _RapiChatBase {
  // ---- 送信 ----

  Future<void> send() async {
    final text = state.input.trim();
    if (text.isEmpty || state.sending) return;
    // 欄にショートカットからの依頼が入っていれば、送れたときに保存先から消す（手を入れて送っても同じ）
    final externalDraftId = state.activeExternalDraftId;
    var delivered = false;

    // 選ばれないまま残っているタスク選びカードは閉じる（あとで押して古い発言が送られないように）
    _closePendingPickers();
    final consult = state.consultTask;
    final history = consult == null ? _history() : _consultHistory(consult.id);
    final userId = _nextId;
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.user,
          text: text,
          inHistory: true,
          consultTaskId: consult?.id,
        ));
    // 送った文は自分の発言として並ぶので、欄は送った時点で空にする（応答待ちの間も残さない）。
    // 画面は provider の input に合わせて欄を書き換えるので、タブを往復しても送った文は戻らない
    state = state.copyWith(sending: true, input: '');

    try {
      if (consult != null) {
        // 相談モード中は振り分けを通さず、そのタスクの相談として送る。
        // ただし「伴走して」「伴走をやめて」なら、相談ではなく伴走の確認カードを出す
        if (!await _offerCompanion(text, consultTaskId: consult.id)) {
          await _sendConsult(consult, text, history);
        }
      } else if (!await _offerCompanion(text, userId: userId, externalDraftId: externalDraftId)) {
        await _routeAndHandle(text, history, userId, externalDraftId: externalDraftId);
      }
      delivered = true;
    } catch (e) {
      _sendFailed(e, text, userId);
    } finally {
      state = state.copyWith(sending: false);
    }
    // NOTE: 送れなかったときは消さない（_sendFailed が欄に文を戻すので、依頼はまだ欄にある）。
    // 相談に振り分けられた依頼も消さない（タスク選びのカードを出しただけで、本文はまだ送っていない。
    // chooseConsultTask で送れたときに消す。PR #1473 再レビュー指摘 P1）
    if (!delivered) return;
    if (externalDraftId != null && !_heldExternalDrafts.containsKey(externalDraftId)) {
      await _consumeExternalDraft(externalDraftId);
    }
    // NOTE: 欄の依頼でない文（書きかけ）を送ったときも、欄が空けば待っている依頼を入れる。
    // 依頼を送ったときだけ進めていたので、書きかけを送ると依頼が一覧に残ったままになった（同 P2）
    _fillNextExternalDraft();
  }

  /// 送れなかった発言を履歴から外し、文を欄に戻して理由を出す
  @override
  void _sendFailed(Object e, String text, int userId) {
    final messages = [...state.messages];
    final i = messages.indexWhere((m) => m.id == userId);
    if (i >= 0) messages[i] = messages[i].withoutHistory();
    // 失敗したら送れなかった文を欄に戻す（直して送り直せる）。
    // 応答待ちの間に次の文を書き始めていたら、それは消さない（送れなかった文は発言として残っている）
    state = state.copyWith(
      messages: messages,
      input: state.input.trim().isEmpty ? text : null,
    );
    _system(e is AssistantTimeoutException ? rapiTimeoutMessage : '送信に失敗しました');
  }

  Future<void> _routeAndHandle(String text, List<Map<String, String>> history, int userId,
      {String? externalDraftId}) async {
    final service = ref.read(assistantServiceProvider);
    // 相談モード中は true（相談モード中の送信はここを通らないので、効くのはそれ以外の経路）
    final routed =
        await service.routeIntent(text, hasOpenTask: state.consultTask != null);

    String took(String where) {
      final reason = routed.reason;
      return reason != null && reason.isNotEmpty
          ? '$whereとして受け取りました — $reason'
          : '$whereとして受け取りました';
    }

    switch (routed.intent) {
      case 'create':
        _system(took('タスク作成'));
        await _runDraft(text);
      case 'ask':
        _system(took('タスクへの問い合わせ'));
        await _runAsk(text);
      case 'watch':
        _system(took('見守り'));
        // 読み込み完了を待ち、失敗は send() の失敗処理へ伝える
        // （再読み込みボタンが始めた読み込みがあればそれに合流する）
        await loadSurvey(propagateError: true);
      case 'change':
        _system(took('タスクの変更'));
        await _runChangeDraft(text);
      case 'roadmap':
        _system(took('計画づくり'));
        await _runRoadmapDraft(text);
      case 'consult':
        _system(took('タスクについての相談'));
        _askConsultTask(text, userId, externalDraftId: externalDraftId);
      case 'tidy':
        _system(took('タスクの片付け'));
        _runTidy(text);
      default:
        // chat と未振り分けは会話として返す
        final reply = await service.chat(text, history: history);
        _add((id) => RapiMessage(
              id: id,
              role: RapiRole.assistant,
              text: reply.content,
              inHistory: true,
            ));
    }
  }

}
