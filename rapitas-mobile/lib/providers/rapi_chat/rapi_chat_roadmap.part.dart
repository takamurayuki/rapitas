// ラピの会話の処理のうち、計画（roadmap）カード。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiRoadmapOps on _RapiChatBase {
  // ---- 計画（roadmap）----
  // 文 → roadmap/draft の計画カード →（質問があれば）選んで「この内容で作り直す」で
  // answers 付きの再下書き → 最終確認で「この計画で作成する」→ roadmap/commit（confirmed: true）。
  // 作るのはカードに出ている下書きそのもの（画面で組み替えない）。
  // NOTE: デスクトップの締めのノートは作らない（ノートはデスクトップのブラウザ内ストレージにしか
  // 無く、サーバーに保存先が無い）。commit はノートなしで完結する。

  @override
  Future<void> _runRoadmapDraft(String text) async {
    final draft = await ref.read(assistantServiceProvider).roadmapDraft(text);
    if (draft == null) {
      // 作れなかった（空の計画を「やることが無い」と見せない）
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.assistant,
            text: 'この依頼からは計画を作れませんでした。目標や期限を添えて、もう一度送ってください。',
          ));
      return;
    }
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          roadmap: RapiRoadmapCard.fromDraft(text, draft),
        ));
  }

  RapiRoadmapCard? _roadmapOf(int messageId) {
    for (final m in state.messages) {
      // 読み込んだ記録（archived）のカードは読み取り専用。ここで引けなくして、全ての操作を止める（設計 nav39 5.3.1）
      if (m.id == messageId) return m.archived ? null : m.roadmap;
    }
    return null;
  }

  void _setRoadmap(int messageId, RapiRoadmapCard card) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withRoadmap(card) : m,
    ]);
  }

  /// 質問 [index] の答えを [answer] にする（質問に答えている間だけ）
  void chooseRoadmapAnswer(int messageId, int index, String answer) {
    final card = _roadmapOf(messageId);
    if (card == null || card.phase != RapiRoadmapPhase.questions) return;
    if (index < 0 || index >= card.asked.length) return;
    final answers = [...card.answers];
    while (answers.length < card.asked.length) {
      answers.add(null);
    }
    answers[index] = answer;
    _setRoadmap(messageId, card.copyWith(answers: answers));
  }

  /// 「この内容で作り直す」：選んだ答えを付けて同じ文でもう一度下書きする
  Future<void> refineRoadmap(int messageId) async {
    final card = _roadmapOf(messageId);
    if (card == null || card.phase != RapiRoadmapPhase.questions) return;
    _setRoadmap(messageId, card.copyWith(phase: RapiRoadmapPhase.refining, error: null));
    try {
      final draft = await ref
          .read(assistantServiceProvider)
          .roadmapDraft(card.text, answers: card.decisions);
      final now = _roadmapOf(messageId) ?? card;
      if (draft == null) {
        _setRoadmap(
            messageId,
            now.copyWith(
                phase: RapiRoadmapPhase.questions,
                error: '計画を作り直せませんでした。もう一度試してください。'));
        return;
      }
      if (draft.hasQuestions) {
        // まだ聞きたいことがある：新しい質問に入れ替えて、もう一度答えてもらう
        final next = RapiRoadmapCard.fromDraft(card.text, draft);
        _setRoadmap(messageId,
            now.copyWith(draft: draft, asked: next.asked, answers: next.answers,
                phase: RapiRoadmapPhase.questions, error: null));
        return;
      }
      _setRoadmap(
          messageId, now.copyWith(draft: draft, phase: RapiRoadmapPhase.ready, error: null));
    } catch (e) {
      _setRoadmap(
        messageId,
        (_roadmapOf(messageId) ?? card).copyWith(
          phase: RapiRoadmapPhase.questions,
          error: e is AssistantTimeoutException
              ? '応答に時間がかかり、作り直せませんでした。もう一度試してください。'
              : '計画を作り直せませんでした。もう一度試してください。',
        ),
      );
    }
  }

  /// 計画の手順 [step] の完了条件 [index] を採る／外す（最終確認の間だけ）
  void toggleRoadmapCriterion(int messageId, int step, int index) =>
      _editRoadmapCriteria(messageId, step, (e) => e.toggled(index));

  /// 計画の手順 [step] の完了条件 [index] の文言を [text] に直す（最終確認の間だけ）
  void editRoadmapCriterion(int messageId, int step, int index, String text) =>
      _editRoadmapCriteria(messageId, step, (e) => e.rewritten(index, text));

  void _editRoadmapCriteria(
      int messageId, int step, RapiCriteriaEdit Function(RapiCriteriaEdit) change) {
    final card = _roadmapOf(messageId);
    if (card == null || card.phase != RapiRoadmapPhase.ready) return;
    if (step < 0 || step >= card.stepCriteria.length) return;
    final next = change(card.stepCriteria[step]);
    if (identical(next, card.stepCriteria[step])) return;
    _setRoadmap(messageId, card.withStepCriteria(step, next));
    final draft = card.draft;
    final s = draft.steps[step];
    _reviewCriteria(
      edit: next,
      title: s.title,
      description: s.descriptionWithoutCriteria,
      read: () {
        final now = _roadmapOf(messageId);
        return now != null && identical(now.draft, draft) && step < now.stepCriteria.length
            ? now.stepCriteria[step]
            : null;
      },
      write: (e) {
        final now = _roadmapOf(messageId);
        if (now != null) _setRoadmap(messageId, now.withStepCriteria(step, e));
      },
    );
  }

  /// 「やめる」：作成前のカードを下げる（何も作っていない）
  void cancelRoadmap(int messageId) {
    final phase = _roadmapOf(messageId)?.phase;
    if (phase != RapiRoadmapPhase.questions && phase != RapiRoadmapPhase.ready) return;
    state = state.copyWith(
        messages: state.messages.where((m) => m.id != messageId).toList());
  }

  void _refreshAfterRoadmap(RapiRoadmapCard card) {
    ref.invalidate(taskListProvider);
    // 新しいテーマを作ったかもしれない（テーマの一覧・作成カードの選択肢に出す）
    if (card.draft.themeChoice.isNew) ref.invalidate(themeListProvider);
  }

  /// 「この計画で作成する」：カードに出ている計画をそのまま confirmed: true で送る
  Future<void> commitRoadmap(int messageId) async {
    final card = _roadmapOf(messageId);
    if (card == null || !card.canCommit) return;
    _setRoadmap(messageId, card.copyWith(phase: RapiRoadmapPhase.committing, error: null));
    try {
      final result = await ref.read(assistantServiceProvider).roadmapCommit(card.confirmedDraft);
      _refreshAfterRoadmap(card);
      _setRoadmap(
          messageId,
          (_roadmapOf(messageId) ?? card)
              .copyWith(phase: RapiRoadmapPhase.committed, result: result));
    } catch (e) {
      final now = _roadmapOf(messageId) ?? card;
      if (_commitOutcomeUnknown(e)) {
        // 応答が失われただけで、サーバーでは作成済みのことがある。二重に作らないよう
        // 「作成する」は出さず、タスク一覧で確かめてもらう
        _refreshAfterRoadmap(card);
        _setRoadmap(
            messageId, now.copyWith(phase: RapiRoadmapPhase.commitUnknown, error: null));
        return;
      }
      _setRoadmap(messageId,
          now.copyWith(phase: RapiRoadmapPhase.ready, error: _commitError(e)));
    }
  }

  /// 作成の失敗が「作られたか分からない」ものか。「作成していない」と言い切れるのは、
  /// サーバーが明示的に断った場合（4xx＝400〜499、または 2xx で明示的な success:false）だけ。
  /// それ以外（connectionError / connectionTimeout を含む通信の失敗、タイムアウト、1xx・3xx・5xx、
  /// 形や辻褄の合わない応答 unexpected_response、想定外の例外）はすべて不明扱い。
  /// 3xx はリダイレクト先で処理されたかもしれず、断られたとは言えないので不明に倒す。
  ///
  /// change の [_applyOutcomeUnknown] より厳しい。送信後に応答を受け取れなかった通信障害も
  /// connectionError になりうるうえ、commit は冪等ではない（作り直すとテーマ・タスクが
  /// 二重にできる）。change は同じ値の再適用で、サーバー側に no_change の受け止めがある。
  static bool _commitOutcomeUnknown(Object e) {
    if (e is AssistantException) {
      final status = e.statusCode;
      if (status == null) return true;
      // 2xx の AssistantException は roadmapCommit が明示的な success:false で投げたもの
      final rejected = (status >= 400 && status < 500) || (status >= 200 && status < 300);
      return !rejected;
    }
    return true;
  }

  static String _commitError(Object e) {
    // ここに来るのはサーバーが明示的に断ったものだけ（_commitOutcomeUnknown 参照）
    final status = e is AssistantException ? e.statusCode : null;
    if (status != null && status >= 400 && status < 500) {
      return 'この計画の内容は受け付けられませんでした。何も作成していません。';
    }
    return '作成できませんでした。何も作成していません。もう一度試してください。';
  }

}
