// ラピの会話の処理のうち、ショートカットから届いた依頼（下書き）の受け取りと、入力欄への出し入れ。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiExternalOps on _RapiChatBase {
  /// ショートカット「ラピに依頼」から届いた依頼を下書きとして受け取る（送信はしない）。
  ///
  /// 入力欄が空なら最新の依頼を欄に入れ、ほかの依頼は案内の中に並べる。書きかけの文があれば
  /// 消さずに、すべての依頼を案内の中に並べる。並べた依頼は、欄の依頼を送るか破棄したときに
  /// 1件ずつ欄に入れる。すでに受け取った依頼（同じ番号）は無視する。
  ///
  /// @param requests - 届いた依頼（届いた順） / ExternalDraftInbox に保存済みのもの
  /// @returns 新しい依頼があったか
  bool receiveExternalDraft(List<PendingRapiRequest> requests) {
    final known = {for (final d in _externalDrafts) d.id, ..._heldExternalDrafts.keys};
    final fresh = [for (final r in requests) if (known.add(r.id)) r];
    if (fresh.isEmpty) return false;
    _externalDrafts.addAll(fresh);

    final active = _canFillInput ? fresh.last : null;
    final listed = [for (final r in fresh) if (r.id != active?.id) r];
    final failed = fresh.any((r) => !r.needsConfirmationOnly);
    final lines = <String>[
      active != null
          ? 'ショートカットから届いた依頼を入力欄に入れました。送信すると続きを確認できます。'
          : 'ショートカットから依頼が届きました。書きかけの文はそのままにしています。',
      if (failed) 'ショートカットからはデスクトップに送れなかったので、ここから送り直してください。',
      if (listed.isNotEmpty) ...[
        active != null ? 'ほかにも届いています：' : '届いた依頼：',
        for (final r in listed) '・${r.text}',
        '（入力欄の文を送ると、次の依頼を欄に入れます）',
      ],
    ];
    if (active != null) _fillInput(active);
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.system,
          text: lines.join('\n'),
          externalDraftId: active?.id,
        ));
    return true;
  }

  bool get _canFillInput => state.activeExternalDraftId == null && state.input.trim().isEmpty;

  static String _clipDraft(String text) => text.length > rapiMaxExternalDraftLength
      ? text.substring(0, rapiMaxExternalDraftLength)
      : text;

  void _fillInput(PendingRapiRequest draft) =>
      state = state.copyWith(input: _clipDraft(draft.text), activeExternalDraftId: draft.id);

  /// 送れた・破棄した依頼を保存先から消す
  @override
  Future<void> _consumeExternalDraft(String id) async {
    _externalDrafts.removeWhere((d) => d.id == id);
    _heldExternalDrafts.remove(id);
    if (state.activeExternalDraftId == id) state = state.copyWith(activeExternalDraftId: null);
    try {
      await ref.read(externalDraftInboxProvider).consume(id);
    } catch (_) {
      // 消せなかった依頼は次の起動でまた下書きに戻るだけで、失われはしない
    }
  }

  /// 欄が空いたら、残っている依頼のうち最新を欄に入れる
  @override
  void _fillNextExternalDraft() {
    if (_externalDrafts.isEmpty || !_canFillInput) return;
    final next = _externalDrafts.last;
    final rest = _externalDrafts.length - 1;
    _fillInput(next);
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.system,
          text: [
            'ショートカットから届いた次の依頼を入力欄に入れました。',
            if (!next.needsConfirmationOnly) 'デスクトップに送れなかった依頼です。ここから送り直してください。',
            if (rest > 0) '（あと$rest件あります）',
          ].join('\n'),
          externalDraftId: next.id,
        ));
  }

  /// 相談に振り分けられた依頼を、タスク選びが終わるまで預かる（欄の依頼からは外すが、保存先には残す）
  @override
  void _holdExternalDraft(String id) {
    final i = _externalDrafts.indexWhere((d) => d.id == id);
    if (i >= 0) _heldExternalDrafts[id] = _externalDrafts.removeAt(i);
    if (state.activeExternalDraftId == id) state = state.copyWith(activeExternalDraftId: null);
  }

  /// タスク選びを待っていた依頼を、送らずに終わったので待ち行列へ戻す。
  /// [refilled] なら送れなかった文が欄に戻っているので、欄の依頼にする（送れたら消す・破棄できる）。
  /// そうでなければ最新として並べ、次に欄が空いたときに入れる
  @override
  void _releaseExternalDraft(String? id, {bool refilled = false}) {
    final draft = id == null ? null : _heldExternalDrafts.remove(id);
    if (draft == null) return;
    _externalDrafts.add(draft);
    if (refilled && state.activeExternalDraftId == null) {
      state = state.copyWith(activeExternalDraftId: draft.id);
    }
  }

  /// 入力欄に入れた、ショートカットからの依頼を破棄する（画面の「破棄」から呼ぶ）。
  /// 欄の文に手を入れていなければ欄も空にし、残っている依頼があれば次を入れる
  Future<void> discardExternalDraft() async {
    final id = state.activeExternalDraftId;
    if (id == null || state.sending) return;
    final draft = _externalDrafts.where((d) => d.id == id).firstOrNull;
    if (draft != null && state.input.trim() == _clipDraft(draft.text).trim()) {
      state = state.copyWith(input: '');
    }
    await _consumeExternalDraft(id);
    _system('ショートカットから届いた依頼を破棄しました。');
    _fillNextExternalDraft();
  }

  /// 入力欄の文を書き戻す（画面の TextEditingController の変更から呼ぶ）
  void setInput(String text) {
    if (state.input == text) return;
    state = state.copyWith(input: text);
  }

}
