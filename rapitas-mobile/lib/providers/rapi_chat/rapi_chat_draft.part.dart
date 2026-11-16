// ラピの会話の処理のうち、起票の下書き。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiDraftOps on _RapiChatBase {
  // ---- タスク作成 ----

  @override
  Future<void> _runDraft(String text) async {
    final draft = await ref.read(assistantServiceProvider).createDraft(text);
    // 下書きは常に1枚。前の下書きは置き換える
    state = state.copyWith(
      messages: state.messages.where((m) => !m.draftSlot).toList(),
      draft: draft,
      draftThemeId: draft.themeId,
      draftTitle: draft.title,
      draftCriteria: RapiCriteriaEdit(
        items: draft.criteriaRows,
        quality: draft.criteriaQuality,
        fallback: draft.acceptanceCriteriaFallback,
      ),
    );
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, draftSlot: true));
  }

  void setDraftTitle(String title) {
    if (state.draftTitle == title) return;
    state = state.copyWith(draftTitle: title);
  }

  void setDraftTheme(String? themeId) => state = state.copyWith(draftThemeId: themeId);

  /// 下書きの完了条件 [index] を採る／外す（作成時に送るのは採ったものだけ）
  void toggleDraftCriterion(int index) {
    if (state.creating || state.draft == null) return;
    _setDraftCriteria(state.draftCriteria.toggled(index));
  }

  /// 下書きの完了条件 [index] の文言を [text] に直す（判定と採点はサーバーに問い合わせ直す）
  void editDraftCriterion(int index, String text) {
    if (state.creating || state.draft == null) return;
    _setDraftCriteria(state.draftCriteria.rewritten(index, text));
  }

  void _setDraftCriteria(RapiCriteriaEdit next) {
    if (identical(next, state.draftCriteria)) return;
    final draft = state.draft;
    state = state.copyWith(draftCriteria: next);
    _reviewCriteria(
      edit: next,
      title: state.draftTitle,
      description: draft?.description,
      read: () => identical(state.draft, draft) ? state.draftCriteria : null,
      write: (e) => state = state.copyWith(draftCriteria: e),
    );
  }

  /// [edit] の採った条件をサーバーに判定し直してもらい、版が変わっていなければ当てる
  /// （起票カード・計画カード共通。サーバーの判定が正）
  @override
  Future<void> _reviewCriteria({
    required RapiCriteriaEdit edit,
    required String title,
    String? description,
    required RapiCriteriaEdit? Function() read,
    required void Function(RapiCriteriaEdit) write,
  }) async {
    final selected = edit.selected;
    if (selected.isEmpty) return;
    try {
      final r = await ref
          .read(assistantServiceProvider)
          .reviewCriteria(title: title, description: description, criteria: selected);
      final now = read();
      if (now != null) write(now.applyReview(edit.revision, r.items, r.quality));
    } catch (_) {
      final now = read();
      if (now != null) write(now.reviewFailedAt(edit.revision));
    }
  }

  void discardDraft() {
    state = state.copyWith(
      messages: state.messages.where((m) => !m.draftSlot).toList(),
      draft: null,
      draftThemeId: null,
      draftCriteria: const RapiCriteriaEdit(),
    );
  }

  Future<void> createFromDraft() async {
    final draft = state.draft;
    final themeId = state.draftThemeId;
    final title = state.draftTitle.trim();
    final criteria = state.draftSelectedCriteria;
    final picked = state.draftCriteria;
    // サーバーは完了条件の無い作成を断る（400）。1件も採っていなければ送らない
    if (draft == null || themeId == null || title.isEmpty || state.creating || criteria.isEmpty) {
      return;
    }

    state = state.copyWith(creating: true);
    try {
      final id = await ref.read(assistantServiceProvider).createTask(
            title: title,
            themeId: themeId,
            description: draft.description,
            priority: draft.priority,
            dueDate: draft.dueDate,
            estimatedHours: draft.estimatedHours,
            // カードのタグどおりに2列で送る（サーバーが同じ規則で分け直す。設計 4.1 案1）
            acceptanceCriteria: picked.selectedJury,
            userAcceptanceChecks: picked.selectedUser,
          );
      ref.invalidate(taskListProvider);
      // 作成中に別の下書きへ置き換わっていたら、そちらは消さない
      if (identical(state.draft, draft)) discardDraft();
      _system('「$title」を起票しました', taskId: id);
    } catch (_) {
      _system('起票に失敗しました。もう一度試してください。');
    } finally {
      state = state.copyWith(creating: false);
    }
  }

}
