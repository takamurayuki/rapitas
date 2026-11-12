// ラピの会話の処理のうち、片付け（tidy）カード。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiTidyOps on _RapiChatBase {
  // ---- 片付け（tidy）----
  // 振り分けが tidy → 片付けカード。出し方は「条件で選ぶ」（delete-filter。既定、デスクトップと同じ）と
  // 「文章で選ぶ」（振り分けられた発言をそのまま delete-draft へ）。どちらも一覧を作るだけで、
  // 候補はすべてチェック済みで出す（デスクトップと同じ。外せる）。「削除する（N件）」で、
  // 出ている候補のうちチェックが残った id だけを task-delete（confirmed: true）へ50件ずつ送る。
  // 削除後は trashId ごとに task-trash/:id/restore で戻せる（1件ずつ・まとめて）。

  @override
  void _runTidy(String text) {
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, tidy: RapiTidyCard(text: text)));
  }

  RapiTidyCard? _tidyOf(int messageId, {bool includeArchived = false}) {
    for (final m in state.messages) {
      // 読み込んだ記録（archived）のカードは読み取り専用。ここで引けなくして、全ての操作を止める
      // （表示だけの「すべて見る」は includeArchived で引く。設計 nav39 5.3.1）
      if (m.id == messageId) return m.archived && !includeArchived ? null : m.tidy;
    }
    return null;
  }

  void _setTidy(int messageId, RapiTidyCard card) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withTidy(card) : m,
    ]);
  }

  /// setup の間だけ条件・出し方を変えられる
  void _editTidySetup(int messageId, RapiTidyCard Function(RapiTidyCard) edit) {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.setup) return;
    _setTidy(messageId, edit(card).copyWith(notice: null, error: null));
  }

  void setTidyHow(int messageId, RapiTidyHow how) =>
      _editTidySetup(messageId, (c) => c.copyWith(how: how));

  void setTidyTheme(int messageId, String? themeId) =>
      _editTidySetup(messageId, (c) => c.copyWith(filter: c.filter.copyWith(themeId: themeId)));

  void toggleTidyStatus(int messageId, String status) => _editTidySetup(messageId, (c) {
        final now = c.filter.statuses;
        final next = now.contains(status)
            ? now.where((s) => s != status).toList()
            : [for (final s in rapiTidyStatuses) if (s == status || now.contains(s)) s];
        return c.copyWith(filter: c.filter.copyWith(statuses: next));
      });

  void setTidyDays(int messageId, int days) =>
      _editTidySetup(messageId, (c) => c.copyWith(filter: c.filter.copyWith(days: days)));

  /// 「該当するタスクを見る」／「候補を探してもらう」：一覧を作る（何も削除しない）
  Future<void> searchTidy(int messageId) async {
    final card = _tidyOf(messageId);
    if (card == null || !card.canSearch) return;
    _setTidy(messageId,
        card.copyWith(phase: RapiTidyPhase.searching, notice: null, error: null));
    final service = ref.read(assistantServiceProvider);
    try {
      if (card.how == RapiTidyHow.condition) {
        final found = await service.deleteFilter(card.filter);
        final now = _tidyOf(messageId) ?? card;
        if (found.matches.isEmpty) {
          _setTidy(
              messageId,
              now.copyWith(
                phase: RapiTidyPhase.setup,
                notice: found.excludedProtected > 0
                    ? '削除できるタスクはありませんでした（当てはまった${found.excludedProtected}件は保護されています）。'
                    : '該当するタスクはありませんでした。条件をゆるめてみてください。',
              ));
          return;
        }
        _setTidy(
            messageId,
            now.copyWith(
              phase: RapiTidyPhase.listing,
              listedBy: RapiTidyHow.condition,
              items: found.matches,
              chosen: {for (final m in found.matches) m.id},
              total: found.total,
              truncated: found.truncated,
              excludedProtected: found.excludedProtected,
              expanded: false,
            ));
      } else {
        final draft = await service.deleteDraft(card.text);
        final now = _tidyOf(messageId) ?? card;
        if (draft.candidates.isEmpty) {
          final window = draft.considered > 0 ? '（最近更新された${draft.considered}件を見ました）' : '';
          final unclear = draft.unclear.isEmpty ? '' : '\n${draft.unclear.map((u) => '・$u').join('\n')}';
          _setTidy(
              messageId,
              now.copyWith(
                phase: RapiTidyPhase.setup,
                notice: draft.available
                    ? '消してよさそうなタスクは見つかりませんでした$window。'
                        '言い方を変えて送り直すか、条件で選んでみてください。$unclear'
                    : '候補を挙げられませんでした（デスクトップ側の AI に届きませんでした）。'
                        '条件で選ぶほうを試してみてください。',
              ));
          return;
        }
        _setTidy(
            messageId,
            now.copyWith(
              phase: RapiTidyPhase.listing,
              listedBy: RapiTidyHow.text,
              items: draft.candidates,
              chosen: {for (final c in draft.candidates) c.id},
              considered: draft.considered,
              unclear: draft.unclear,
              expanded: false,
            ));
      }
    } catch (e) {
      _setTidy(
        messageId,
        (_tidyOf(messageId) ?? card).copyWith(
          phase: RapiTidyPhase.setup,
          error: e is AssistantTimeoutException
              ? '応答に時間がかかり、候補を出せませんでした。もう一度試してください。'
              : '候補を出せませんでした。もう一度試してください。',
        ),
      );
    }
  }

  /// 候補のチェックを切り替える
  void toggleTidyItem(int messageId, String taskId) {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.listing) return;
    if (!card.items.any((i) => i.id == taskId)) return;
    final chosen = {...card.chosen};
    if (!chosen.remove(taskId)) chosen.add(taskId);
    _setTidy(messageId, card.copyWith(chosen: chosen));
  }

  /// 候補をすべて選ぶ／すべて外す
  void setTidyAll(int messageId, bool selected) {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.listing) return;
    _setTidy(messageId,
        card.copyWith(chosen: selected ? {for (final i in card.items) i.id} : <String>{}));
  }

  /// 長い一覧を全部出す
  void expandTidy(int messageId) {
    final card = _tidyOf(messageId, includeArchived: true);
    if (card == null || card.expanded) return;
    _setTidy(messageId, card.copyWith(expanded: true));
  }

  /// 「選び直す」：候補を捨てて条件の選択に戻る（何も削除していない）
  void backToTidySetup(int messageId) {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.listing) return;
    _setTidy(
        messageId,
        card.copyWith(
            phase: RapiTidyPhase.setup, items: const [], chosen: const {}, expanded: false));
  }

  /// 「やめる」：削除前のカードを下げる（何も削除していない）
  void cancelTidy(int messageId) {
    final phase = _tidyOf(messageId)?.phase;
    if (phase != RapiTidyPhase.setup && phase != RapiTidyPhase.listing) return;
    state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList());
  }

  void _refreshAfterTidy() {
    ref.invalidate(taskListProvider);
    ref.invalidate(taskDetailProvider);
  }

  /// 「削除する（N件）」：出ている候補のうちチェックが残ったものだけを、50件ずつ confirmed: true で送る
  Future<void> deleteTidy(int messageId) async {
    final card = _tidyOf(messageId);
    if (card == null || !card.canDelete) return;
    final ids = card.chosenIds;
    final batches = (ids.length + rapiTidyBatchSize - 1) ~/ rapiTidyBatchSize;
    _setTidy(messageId,
        card.copyWith(phase: RapiTidyPhase.deleting, progress: (0, batches), error: null));
    TaskDeleteRun run;
    try {
      run = await ref.read(assistantServiceProvider).deleteTasks(ids,
          onProgress: (done, of) =>
              _setTidy(messageId, (_tidyOf(messageId) ?? card).copyWith(progress: (done, of))));
    } catch (_) {
      // deleteTasks は回ごとの失敗を結果に入れて返す。ここに来るのは想定外の失敗だけなので、
      // 削除されたか分からないものとして扱う（押し直させない）
      run = TaskDeleteRun(unknown: ids);
    }
    _refreshAfterTidy();
    _setTidy(
        messageId,
        (_tidyOf(messageId) ?? card)
            .copyWith(phase: RapiTidyPhase.done, run: run, progress: null, expanded: false));
  }

  /// 削除したタスク1件を戻す（[trashId] はその削除のゴミ箱の行）
  Future<void> restoreTidy(int messageId, int trashId) async {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.done || card.restoring) return;
    if (!card.restorable.contains(trashId)) return;
    await _restoreTidy(messageId, [trashId]);
  }

  /// 削除したものをまとめて戻す（まだ戻していないものを順に）
  Future<void> restoreAllTidy(int messageId) async {
    final card = _tidyOf(messageId);
    if (card == null || card.phase != RapiTidyPhase.done || card.restoring) return;
    final targets = card.restorable;
    if (targets.isEmpty) return;
    await _restoreTidy(messageId, targets);
  }

  Future<void> _restoreTidy(int messageId, List<int> trashIds) async {
    void mark(int trashId, RapiTidyRestore r) {
      final now = _tidyOf(messageId);
      if (now == null) return;
      _setTidy(messageId, now.copyWith(restores: {...now.restores, trashId: r}));
    }

    for (final t in trashIds) {
      mark(t, RapiTidyRestore.restoring);
    }
    final service = ref.read(assistantServiceProvider);
    for (final t in trashIds) {
      try {
        await service.restoreFromTrash(t);
        mark(t, RapiTidyRestore.restored);
      } catch (e) {
        // 409 not_restorable：戻せるものが無い（復元済み・控えが読めない）。押し直しても同じ
        final gone = e is AssistantException &&
            (e.code == 'not_restorable' || e.statusCode == 409);
        mark(t, gone ? RapiTidyRestore.unavailable : RapiTidyRestore.failed);
      }
    }
    _refreshAfterTidy();
  }

}
