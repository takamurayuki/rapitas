// ラピの会話のカードの状態（変更・伴走・計画）。
//
// 不変オブジェクトで、更新は copyWith による差し替え。provider（rapi_chat_provider.dart）が
// 発言ごとに持ち、画面はこれを描く。NOTE: provider の分割（nav39 v1-0a）でここへ移した。挙動は変えていない。

import '../rapi.dart';

const Object _unset = Object();

/// 変更カードの段階。proposed（確認待ち）→ applying → applied（取り消せる）→ reverting → reverted。
/// 適用の応答が失われたら applyUnknown（サーバーでは適用済みかもしれないので、再適用させない）。
/// 取り消しが no_undoable_update（取り消せる記録がない）なら revertUnavailable（取り消しを終える）。
enum RapiChangePhase {
  proposed,
  applying,
  applied,
  reverting,
  reverted,
  applyUnknown,
  revertUnavailable,
}

/// 変更（change）カード1枚の状態。カードは発言ごとに持つ（前のカードの「取り消す」を残すため）
class RapiChangeCard {
  final ChangeProposal proposal;

  /// update-draft が検討したタスク数（最近更新された最大60件）
  final int considered;
  final RapiChangePhase phase;

  /// 適用した結果（applied 以降）。取り消しの actionId と、実際に変わった項目の前後
  final TaskUpdateResult? result;

  /// 取り消しが 409 で断られたときの、その後に編集された項目
  final List<String> conflicts;

  /// カード内に出す失敗の案内
  final String? error;

  const RapiChangeCard({
    required this.proposal,
    this.considered = 0,
    this.phase = RapiChangePhase.proposed,
    this.result,
    this.conflicts = const [],
    this.error,
  });

  RapiChangeCard copyWith({
    RapiChangePhase? phase,
    TaskUpdateResult? result,
    List<String>? conflicts,
    Object? error = _unset,
  }) =>
      RapiChangeCard(
        proposal: proposal,
        considered: considered,
        phase: phase ?? this.phase,
        result: result ?? this.result,
        conflicts: conflicts ?? this.conflicts,
        error: identical(error, _unset) ? this.error : error as String?,
      );

  /// 「取り消す」を押せるか（競合で断られたあとは出さない）
  bool get canRevert => phase == RapiChangePhase.applied && conflicts.isEmpty;
}

/// 伴走カードの段階。proposed（確認待ち）→ applying → applied。
/// 応答が失われたら applyUnknown（サーバーでは反映済みかもしれないので、押し直させない）。
enum RapiCompanionPhase { proposed, applying, applied, applyUnknown }

/// 「伴走して」「伴走をやめて」の確認カード1枚の状態
class RapiCompanionCard {
  final RapiCompanionProposal proposal;
  final RapiCompanionPhase phase;

  /// カード内に出す失敗の案内
  final String? error;

  const RapiCompanionCard({
    required this.proposal,
    this.phase = RapiCompanionPhase.proposed,
    this.error,
  });

  RapiCompanionCard copyWith({RapiCompanionPhase? phase, Object? error = _unset}) =>
      RapiCompanionCard(
        proposal: proposal,
        phase: phase ?? this.phase,
        error: identical(error, _unset) ? this.error : error as String?,
      );
}

/// 計画カードの段階。
/// questions（質問に答えて作り直す）→ refining → ready（最終確認）→ committing → committed。
/// サーバーが断ったと言い切れない作成の失敗（通信の失敗・5xx・形の異常など）は commitUnknown
/// （サーバーでは作成済みかもしれないので、作り直させない）。
enum RapiRoadmapPhase { questions, refining, ready, committing, committed, commitUnknown }

/// 計画（roadmap）カード1枚の状態。カードは発言ごとに持つ（change カードと同じ）
class RapiRoadmapCard {
  /// 依頼の文（作り直しでも同じ文を送る）
  final String text;

  /// いま画面に出している下書き（作成するのはこの内容そのまま）
  final RoadmapDraft draft;

  /// 1回目に聞かれた質問。最終形の下書きは質問を返さないので、決めたことを出すために残す
  final List<RoadmapQuestion> asked;

  /// [asked] の各質問で選んでいる答え（初期値は推奨）
  final List<String?> answers;
  final RapiRoadmapPhase phase;
  final RoadmapCommitResult? result;

  /// カード内に出す失敗の案内
  final String? error;

  /// 手順ごとの完了条件の編集状態（[draft] の steps と同じ順。設計 段B の「採否・文言」）
  final List<RapiCriteriaEdit> stepCriteria;

  RapiRoadmapCard({
    required this.text,
    required this.draft,
    this.asked = const [],
    this.answers = const [],
    this.phase = RapiRoadmapPhase.ready,
    this.result,
    this.error,
    List<RapiCriteriaEdit>? stepCriteria,
  }) : stepCriteria = stepCriteria ?? criteriaOf(draft);

  /// 下書きの手順それぞれの、初めの編集状態（サーバーの判定と採点のまま）
  static List<RapiCriteriaEdit> criteriaOf(RoadmapDraft draft) => [
        for (final s in draft.steps)
          RapiCriteriaEdit(items: s.criteriaRows, quality: s.criteriaQuality),
      ];

  /// 下書き [draft] から作る。質問があれば推奨を初期選択にして questions から始める
  factory RapiRoadmapCard.fromDraft(String text, RoadmapDraft draft) => draft.hasQuestions
      ? RapiRoadmapCard(
          text: text,
          draft: draft,
          asked: draft.questions,
          answers: [for (final q in draft.questions) q.initialAnswer],
          phase: RapiRoadmapPhase.questions,
        )
      : RapiRoadmapCard(text: text, draft: draft);

  RapiRoadmapCard copyWith({
    RoadmapDraft? draft,
    List<RoadmapQuestion>? asked,
    List<String?>? answers,
    RapiRoadmapPhase? phase,
    RoadmapCommitResult? result,
    Object? error = _unset,
    List<RapiCriteriaEdit>? stepCriteria,
  }) =>
      RapiRoadmapCard(
        text: text,
        draft: draft ?? this.draft,
        asked: asked ?? this.asked,
        answers: answers ?? this.answers,
        phase: phase ?? this.phase,
        result: result ?? this.result,
        error: identical(error, _unset) ? this.error : error as String?,
        // 下書きが入れ替わったら（作り直し）、条件の編集も新しい手順から始め直す
        stepCriteria: stepCriteria ?? (draft != null ? null : this.stepCriteria),
      );

  /// 手順 [index] の完了条件の編集状態を [edit] にしたカード
  RapiRoadmapCard withStepCriteria(int index, RapiCriteriaEdit edit) => copyWith(
        stepCriteria: [
          for (var i = 0; i < stepCriteria.length; i++) i == index ? edit : stepCriteria[i],
        ],
      );

  /// commit で送る計画：各手順の条件を、カードで採った・直したものにする（陪審／本人の2列）
  RoadmapDraft get confirmedDraft => RoadmapDraft(
        goal: draft.goal,
        themeChoice: draft.themeChoice,
        projectChoice: draft.projectChoice,
        questions: draft.questions,
        steps: [
          for (var i = 0; i < draft.steps.length; i++)
            i < stepCriteria.length
                ? draft.steps[i].withConfirmed(
                    jury: stepCriteria[i].selectedJury, user: stepCriteria[i].selectedUser)
                : draft.steps[i],
        ],
        deadline: draft.deadline,
        assumptions: draft.assumptions,
        comparisonAxes: draft.comparisonAxes,
      );

  /// 質問と選んだ答え（聞かれた順）
  List<RoadmapAnswer> get decisions => [
        for (var i = 0; i < asked.length; i++)
          RoadmapAnswer(
              question: asked[i].question, answer: i < answers.length ? answers[i] ?? '' : ''),
      ];

  /// 「この計画で作成する」を押せるか（作るタスクが無い計画は作らない）
  bool get canCommit =>
      phase == RapiRoadmapPhase.ready &&
      draft.goal.trim().isNotEmpty &&
      draft.steps.isNotEmpty &&
      // どの手順にも完了条件が1つ以上残っている（サーバーは無い手順があると全体を断る）
      stepCriteria.every((c) => c.items.isEmpty || c.selected.isNotEmpty);
}
