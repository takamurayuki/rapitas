// ラピの会話の処理のうち、会話スペースの切り替えに要る最小限の入口（設計 nav39 6.2・6.3）。
//
// 読み込み・保存の列・最後に開いたスペースの記憶は rapi_chat_spaces_provider.dart が持つ。
// ここに置くのは、会話の中身（state.messages）を入れ替える処理と、切り替えの可否の判定だけ。

part of '../rapi_chat_provider.dart';

mixin _RapiSpaceOps on _RapiChatBase {
  /// 保存に使う行の鍵。読み込んだ記録はサーバーの値、いまのセッションの行は端末内の id から作る
  String clientIdOf(RapiMessage m) => m.clientId ?? '$_clientSession-${m.id}';

  /// 応答待ち・いまのセッションのカードの処理中は、スペースを切り替えさせない（設計 6.2 の 1）。
  /// 読み込んだ記録（archived）は処理の途中の段階で戻ってきても数えない（二度と終わらないため）
  bool get busyForSwitch =>
      state.sending || state.creating || state.messages.any((m) => !m.archived && rapiCardBusy(m));

  /// 切り替えを始める：相談を抜け、タスク選び・下書き・見守りを片付け、挨拶だけを残す。
  /// 入力欄とショートカットの依頼は残す（設計 6.2 の 3〜6）。
  ///
  /// @returns 切り替えの目印。これ以降に足された行は、読み込み結果のあとに残す（[applySpace]）
  int beginSpace() {
    if (state.consultTask != null) {
      // 帯の「相談を終えました」は出さない（設計 6.2 の 3）。読み込み中の相談の結果は世代で捨てる
      _consultSession++;
      state = state.copyWith(consultTask: null);
    }
    _closePendingPickers();
    _fillNextExternalDraft();
    state = state.copyWith(
      messages: [for (final m in state.messages) if (m.id == _greetingId) m],
      draft: null,
      draftThemeId: null,
      draftTitle: '',
      draftCriteria: const RapiCriteriaEdit(),
      survey: null,
      surveyLoading: false,
      surveyFailed: false,
    );
    return _nextId;
  }

  /// 読み込んだ記録 [loaded] を挨拶のあとに並べる。[since] 以降に足された行（読み込み中に届いた
  /// ショートカットの案内など）は、その後ろに残す（設計 6.2 の 7）
  void applySpace(List<RapiMessage> loaded, {required int since}) {
    final greeting = [for (final m in state.messages) if (m.id == _greetingId) m];
    final later = [for (final m in state.messages) if (m.id >= since && m.id != _greetingId) m];
    // 読み込み中に足された行は、もう保存待ちにも積まれていて、重ね合わせで記録としても戻ってくる。
    // 同じ行を二重に出さないよう、後ろに残すいまの行を正とする
    final live = {for (final m in later) clientIdOf(m)};
    state = state.copyWith(messages: [
      ...greeting,
      for (final m in loaded)
        if (!live.contains(m.clientId)) m.withId(_nextId++),
      ...later,
    ]);
  }

  /// 「前の会話を読み込む」で読んだ [older] を、記録の先頭（挨拶のすぐ後ろ）に足す
  void prependArchived(List<RapiMessage> older) {
    if (older.isEmpty) return;
    final rest = [for (final m in state.messages) if (m.id != _greetingId) m];
    final greeting = [for (final m in state.messages) if (m.id == _greetingId) m];
    state = state.copyWith(messages: [
      ...greeting,
      for (final m in older) m.withId(_nextId++),
      ...rest,
    ]);
  }

  /// 端末だけの案内（保存しない。保存の失敗・前回の会話の削除など）
  void localNotice(String text) => _add(
      (id) => RapiMessage(id: id, role: RapiRole.system, text: text, localOnly: true));
}

/// カードが処理中の段階か（切り替えの判定と、保存をすぐ送るかの判定に使う。設計 6.2 の 1 の表）
bool rapiCardBusy(RapiMessage m) {
  final change = m.change?.phase;
  if (change == RapiChangePhase.applying || change == RapiChangePhase.reverting) return true;
  final roadmap = m.roadmap?.phase;
  if (roadmap == RapiRoadmapPhase.refining || roadmap == RapiRoadmapPhase.committing) return true;
  final tidy = m.tidy;
  if (tidy != null &&
      (tidy.phase == RapiTidyPhase.searching || tidy.phase == RapiTidyPhase.deleting || tidy.restoring)) {
    return true;
  }
  return m.companion?.phase == RapiCompanionPhase.applying;
}
