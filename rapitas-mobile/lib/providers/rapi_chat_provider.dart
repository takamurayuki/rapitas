import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/rapi.dart';
import '../models/task.dart';
import '../services/assistant_service.dart';
import '../services/external_draft_inbox.dart';
import '../services/home_screen_bridge.dart';
import 'service_providers.dart';
import 'task_provider.dart';
import 'theme_data_provider.dart';

// ラピの会話状態。
//
// /rapi は下部タブで、タブを切り替えると RapiScreen は破棄される。会話・未送信の入力・
// 確認中の下書き・見守りの結果はここ（autoDispose しない provider）に置き、
// 画面はこれを watch して描画する。応答待ちのままタブを離れても、届いた結果は
// ここで状態へ反映するので捨てられない。
//
// NOTE: 永続化はしない。アプリを終了すると会話は消える。
// NOTE: モード（会話／作る／聞く／見守り／変更／計画／片付け）の切り替えは無い。送った文は毎回
// /assistant/route で振り分け、作成・問い合わせ・見守り・変更・計画・片付けはその結果で出し分ける。
// 例外は相談（consult）：振り分けで相談になり、タスクを選ぶと「相談モード」に入る。
// 相談モード中の送信は振り分けを通さず、そのタスクの copilot/chat へ直接送る（抜けるまで）。
// 例外の例外は伴走（companion）：「伴走」を含む発言は、送る前に /assistant/companion/draft で
// 「伴走して」「伴走をやめて」かを聞く。そうなら確認カードを出し、押されたら start/stop を送る
// （設計 4.3「手動のタスク」）。そうでなければ、いつもどおり相談・振り分けへ送る。

enum RapiRole { user, assistant, system }

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

/// 片付けの候補の出し方。condition（条件で選ぶ：delete-filter）／text（文章で選ぶ：delete-draft）
enum RapiTidyHow { condition, text }

/// 片付けカードの段階。
/// setup（出し方と条件を選ぶ）→ searching → listing（候補をチェックで選ぶ）→ deleting → done（結果と取り消し）。
/// 候補が無かった・出せなかったときは setup に戻して理由を出す。
enum RapiTidyPhase { setup, searching, listing, deleting, done }

/// 削除したタスク1件の取り消しの状態。
/// unavailable はサーバーが 409 not_restorable を返した（復元済み・控えが無い）ので押し直させない。
/// failed は通信の失敗など（押し直してよい：復元済みなら2回目は not_restorable になるだけ）
enum RapiTidyRestore { idle, restoring, restored, unavailable, failed }

/// 片付け（tidy）カード1枚の状態。カードは発言ごとに持つ（前のカードの「元に戻す」を残すため）
class RapiTidyCard {
  /// 振り分けられた発言（文章で選ぶときの依頼文）
  final String text;
  final RapiTidyHow how;
  final TidyFilter filter;
  final RapiTidyPhase phase;

  /// いま出している候補（画面に出たもの。削除するのはこのうちチェックが残ったものだけ）
  final List<TidyItem> items;
  final Set<String> chosen;

  /// 候補をどちらの出し方で出したか（listing 以降の表示に使う）
  final RapiTidyHow listedBy;

  /// 条件で選んだとき：該当の総数・一覧に載りきらなかったか・保護で外した件数
  final int total;
  final bool truncated;
  final int excludedProtected;

  /// 文章で選んだとき：検討したタスク数と、判断できなかったこと
  final int considered;
  final List<String> unclear;

  /// 一覧を全部出しているか（長い一覧は先頭だけ出す）
  final bool expanded;

  /// 削除の進み具合（終えた回数, 全回数）
  final (int, int)? progress;

  /// 削除の結果（done）
  final TaskDeleteRun? run;

  /// 取り消しの状態（trashId ごと）
  final Map<int, RapiTidyRestore> restores;

  /// setup に出す案内（該当なし・候補を出せなかった など）
  final String? notice;

  /// カード内に出す失敗の案内
  final String? error;

  const RapiTidyCard({
    required this.text,
    this.how = RapiTidyHow.condition,
    this.filter = const TidyFilter(),
    this.phase = RapiTidyPhase.setup,
    this.items = const [],
    this.chosen = const {},
    this.listedBy = RapiTidyHow.condition,
    this.total = 0,
    this.truncated = false,
    this.excludedProtected = 0,
    this.considered = 0,
    this.unclear = const [],
    this.expanded = false,
    this.progress,
    this.run,
    this.restores = const {},
    this.notice,
    this.error,
  });

  RapiTidyCard copyWith({
    RapiTidyHow? how,
    TidyFilter? filter,
    RapiTidyPhase? phase,
    List<TidyItem>? items,
    Set<String>? chosen,
    RapiTidyHow? listedBy,
    int? total,
    bool? truncated,
    int? excludedProtected,
    int? considered,
    List<String>? unclear,
    bool? expanded,
    Object? progress = _unset,
    TaskDeleteRun? run,
    Map<int, RapiTidyRestore>? restores,
    Object? notice = _unset,
    Object? error = _unset,
  }) =>
      RapiTidyCard(
        text: text,
        how: how ?? this.how,
        filter: filter ?? this.filter,
        phase: phase ?? this.phase,
        items: items ?? this.items,
        chosen: chosen ?? this.chosen,
        listedBy: listedBy ?? this.listedBy,
        total: total ?? this.total,
        truncated: truncated ?? this.truncated,
        excludedProtected: excludedProtected ?? this.excludedProtected,
        considered: considered ?? this.considered,
        unclear: unclear ?? this.unclear,
        expanded: expanded ?? this.expanded,
        progress: identical(progress, _unset) ? this.progress : progress as (int, int)?,
        run: run ?? this.run,
        restores: restores ?? this.restores,
        notice: identical(notice, _unset) ? this.notice : notice as String?,
        error: identical(error, _unset) ? this.error : error as String?,
      );

  /// 長い一覧で、最初に出す件数（残りは「残りも表示」で出す）
  static const int previewRows = 20;

  /// 画面に出している候補（畳んでいる間は先頭 [previewRows] 件）
  List<TidyItem> get visibleItems =>
      expanded || items.length <= previewRows ? items : items.sublist(0, previewRows);

  /// まだ出していない候補の数
  int get hiddenCount => items.length - visibleItems.length;

  /// 削除に送る id：画面に出ている候補のうちチェックが残ったもの（候補の順）。
  /// 畳んで出していない候補は、チェックが付いていても送らない（見ていないものは消さない）
  List<String> get chosenIds =>
      [for (final i in visibleItems) if (chosen.contains(i.id)) i.id];

  /// 「削除する」を押せるか
  bool get canDelete => phase == RapiTidyPhase.listing && chosenIds.isNotEmpty;

  /// 「候補を出す」を押せるか（条件は状態を1つ以上。文章は依頼文がある）
  bool get canSearch =>
      phase == RapiTidyPhase.setup &&
      (how == RapiTidyHow.condition ? filter.canPreview : text.trim().isNotEmpty);

  /// どれかを戻している最中か
  bool get restoring => restores.values.contains(RapiTidyRestore.restoring);

  /// 取り消しの状態（記録が無ければ idle）
  RapiTidyRestore restoreOf(int trashId) => restores[trashId] ?? RapiTidyRestore.idle;

  /// まだ戻せる（戻していない・前回失敗した）ゴミ箱の行
  List<int> get restorable => [
        for (final d in run?.deleted ?? const <TaskDeletion>[])
          if (d.trashId case final t?)
            if (restoreOf(t) == RapiTidyRestore.idle || restoreOf(t) == RapiTidyRestore.failed) t,
      ];

  /// id から候補の題名を引く（結果の表示用）
  String titleOf(String id) {
    for (final i in items) {
      if (i.id == id) return i.title;
    }
    return 'タスク#$id';
  }
}

/// 相談（consult）の対象タスク
class RapiConsultTask {
  final String id;
  final String title;

  const RapiConsultTask({required this.id, required this.title});
}

/// 相談のタスク選びカードの段階。choosing（選択待ち）→ chosen（選んだ）／closed（選ばずに閉じた）
enum RapiConsultPickPhase { choosing, chosen, closed }

/// 振り分けが consult になったときに出す「どのタスクについて相談しますか」カード。
/// 発言 [text] はタスクが決まってから最初の相談として送る（それまでは送らない）。
/// [companion] が入っていれば、相談ではなく「どのタスクの伴走を始める／やめるか」を選ぶカード
/// （選んだら相談には入らず、伴走の確認カードを出す）。
class RapiConsultPicker {
  final String text;

  /// 伴走の依頼のためのタスク選びなら、その向き
  final RapiCompanionAction? companion;

  /// 選ぶ前の発言のメッセージ id（選んだら相談スレッドへ移す）
  final int utteranceId;
  final RapiConsultPickPhase phase;
  final RapiConsultTask? chosen;

  /// 発言がショートカットから届いた依頼なら、その番号。相談を送れたときに保存先から消す
  /// （カードを出しただけでは本文はまだ送っていないので、それまでは消さない）
  final String? externalDraftId;

  const RapiConsultPicker({
    required this.text,
    required this.utteranceId,
    this.phase = RapiConsultPickPhase.choosing,
    this.chosen,
    this.externalDraftId,
    this.companion,
  });

  RapiConsultPicker copyWith({RapiConsultPickPhase? phase, RapiConsultTask? chosen}) =>
      RapiConsultPicker(
        text: text,
        companion: companion,
        utteranceId: utteranceId,
        phase: phase ?? this.phase,
        chosen: chosen ?? this.chosen,
        externalDraftId: externalDraftId,
      );
}

/// 会話の1件。[draftSlot] は下書きカードの置き場所、[answer] は問い合わせの回答。
class RapiMessage {
  final int id;
  final RapiRole role;
  final String text;
  final AskAnswer? answer;
  final bool draftSlot;

  /// 変更（change）の提案カード
  final RapiChangeCard? change;

  /// 計画（roadmap）のカード
  final RapiRoadmapCard? roadmap;

  /// 相談のタスク選びカード
  final RapiConsultPicker? consultPicker;

  /// 片付け（tidy）のカード
  final RapiTidyCard? tidy;

  /// 伴走の確認カード
  final RapiCompanionCard? companion;

  /// 相談スレッドの発言なら、そのタスクの id（一般の会話の履歴には含めない）
  final String? consultTaskId;

  /// 起票したタスク（system メッセージから開ける）
  final String? taskId;

  /// copilot/chat の履歴に含めるか（挨拶・送信失敗した発言は含めない）
  final bool inHistory;

  /// ショートカットから届いた依頼を入力欄に入れた案内なら、その依頼の番号（「破棄」を出す）
  final String? externalDraftId;

  const RapiMessage({
    required this.id,
    required this.role,
    this.text = '',
    this.answer,
    this.draftSlot = false,
    this.change,
    this.roadmap,
    this.consultPicker,
    this.tidy,
    this.companion,
    this.consultTaskId,
    this.taskId,
    this.inHistory = false,
    this.externalDraftId,
  });

  RapiMessage _copy({
    RapiChangeCard? change,
    RapiRoadmapCard? roadmap,
    RapiConsultPicker? consultPicker,
    RapiTidyCard? tidy,
    RapiCompanionCard? companion,
    bool? inHistory,
  }) =>
      RapiMessage(
        id: id,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        change: change ?? this.change,
        roadmap: roadmap ?? this.roadmap,
        consultPicker: consultPicker ?? this.consultPicker,
        tidy: tidy ?? this.tidy,
        companion: companion ?? this.companion,
        consultTaskId: consultTaskId,
        taskId: taskId,
        inHistory: inHistory ?? this.inHistory,
        externalDraftId: externalDraftId,
      );

  RapiMessage withoutHistory() => _copy(inHistory: false);

  RapiMessage withChange(RapiChangeCard change) => _copy(change: change);

  RapiMessage withRoadmap(RapiRoadmapCard roadmap) => _copy(roadmap: roadmap);

  RapiMessage withConsultPicker(RapiConsultPicker picker) => _copy(consultPicker: picker);

  RapiMessage withTidy(RapiTidyCard tidy) => _copy(tidy: tidy);

  RapiMessage withCompanion(RapiCompanionCard companion) => _copy(companion: companion);
}

const Object _unset = Object();

class RapiChatState {
  final List<RapiMessage> messages;

  /// 入力欄の文（未送信）。画面の TextEditingController と同期する
  final String input;
  final bool sending;

  // タスク作成：いま確認待ちの下書き
  final TaskDraft? draft;
  final String? draftThemeId;

  /// 下書きカードのタイトル欄の文（編集中の値）
  final String draftTitle;

  /// 下書きの完了条件の編集状態（設計 段B の「採否・文言」）。下書きが無ければ空
  final RapiCriteriaEdit draftCriteria;
  final bool creating;

  // 見守り（振り分けで watch になったときに読み込む）
  final SupervisionSurvey? survey;
  final bool surveyLoading;
  final bool surveyFailed;

  /// 相談モードの対象タスク（null なら通常の振り分け）。相談モード中の送信は振り分けを通さず、
  /// このタスクの copilot/chat へ直接送る
  final RapiConsultTask? consultTask;

  /// 入力欄に入れている、ショートカットから届いた依頼の番号。送れたとき・破棄したときに
  /// 保存先（ExternalDraftInbox）から消す
  final String? activeExternalDraftId;

  const RapiChatState({
    required this.messages,
    this.input = '',
    this.sending = false,
    this.draft,
    this.draftThemeId,
    this.draftTitle = '',
    this.draftCriteria = const RapiCriteriaEdit(),
    this.creating = false,
    this.survey,
    this.surveyLoading = false,
    this.surveyFailed = false,
    this.consultTask,
    this.activeExternalDraftId,
  });

  RapiChatState copyWith({
    List<RapiMessage>? messages,
    String? input,
    bool? sending,
    Object? draft = _unset,
    Object? draftThemeId = _unset,
    String? draftTitle,
    RapiCriteriaEdit? draftCriteria,
    bool? creating,
    Object? survey = _unset,
    bool? surveyLoading,
    bool? surveyFailed,
    Object? consultTask = _unset,
    Object? activeExternalDraftId = _unset,
  }) =>
      RapiChatState(
        messages: messages ?? this.messages,
        input: input ?? this.input,
        sending: sending ?? this.sending,
        draft: identical(draft, _unset) ? this.draft : draft as TaskDraft?,
        draftThemeId:
            identical(draftThemeId, _unset) ? this.draftThemeId : draftThemeId as String?,
        draftTitle: draftTitle ?? this.draftTitle,
        draftCriteria: draftCriteria ?? this.draftCriteria,
        creating: creating ?? this.creating,
        survey: identical(survey, _unset) ? this.survey : survey as SupervisionSurvey?,
        surveyLoading: surveyLoading ?? this.surveyLoading,
        surveyFailed: surveyFailed ?? this.surveyFailed,
        consultTask: identical(consultTask, _unset)
            ? this.consultTask
            : consultTask as RapiConsultTask?,
        activeExternalDraftId: identical(activeExternalDraftId, _unset)
            ? this.activeExternalDraftId
            : activeExternalDraftId as String?,
      );

  /// 作成時に送る完了条件（外したものを除く。並びはカードのまま。直した文は直した文で）
  List<String> get draftSelectedCriteria => draft == null ? const [] : draftCriteria.selected;

  /// 見守りカードを出すか（一度でも読み込みを始めたら一覧の先頭に出し続ける）
  bool get surveyVisible => survey != null || surveyLoading || surveyFailed;
}

/// assistant 系の要求がタイムアウトしたときの system メッセージ
const String rapiTimeoutMessage = '応答に時間がかかり、タイムアウトしました。'
    'デスクトップ側の処理が混んでいるかもしれません。もう一度送ってみてください。';

/// ショートカットから預かった依頼を入力欄に入れるときの上限
/// （入力欄と同じ。バックエンドの MAX_TEXT_LENGTH）
const int rapiMaxExternalDraftLength = 2000;

/// copilot/chat に送る履歴の件数
const int _historyLimit = 10;

/// 相談のタスク選びカードに出す件数
const int rapiConsultCandidateLimit = 5;

/// 相談のタスク選びカードの候補：最近更新された順に [rapiConsultCandidateLimit] 件。
/// 一覧は GET /tasks（親タスクのみ・作成日の新しい順）なので、ここで更新日時の順に並べ直す
List<Task> rapiConsultCandidates(List<Task> tasks) {
  final sorted = [...tasks]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  return sorted.take(rapiConsultCandidateLimit).toList();
}

/// 伴走の依頼が今は当てはまらないときの返事
String rapiCompanionUnavailableText(String reason, String title) {
  switch (reason) {
    case 'already_active':
      return '「$title」はもう伴走しています。やめるときは「伴走をやめて」と送ってください。';
    case 'not_active':
      return '「$title」はいま伴走していません。始めるときは「伴走して」と送ってください。';
    case 'task_done':
      return '「$title」は完了しているので、伴走は始められません。';
  }
  return '「$title」の伴走は今は変えられません。';
}

final rapiChatProvider =
    NotifierProvider<RapiChatNotifier, RapiChatState>(RapiChatNotifier.new);

class RapiChatNotifier extends Notifier<RapiChatState> {
  int _nextId = 0;
  Future<void>? _surveyInFlight;

  /// 相談セッションの世代。相談モードに入るたび・抜けるたびに進める。
  /// 非同期処理（履歴の読み込みなど）のあとで「まだ同じ相談が続いているか」を確かめるのに使う
  int _consultSession = 0;

  /// ショートカットから届き、まだ送っても破棄してもいない依頼（届いた順）
  final List<PendingRapiRequest> _externalDrafts = [];

  /// 相談に振り分けられ、タスク選びを待っている依頼（番号 → 依頼）。本文はまだ送っていないので
  /// 保存先には残し、相談を送れたら消す。送らずに終わったら [_externalDrafts] へ戻す
  final Map<String, PendingRapiRequest> _heldExternalDrafts = {};

  @override
  RapiChatState build() {
    _nextId = 0;
    _surveyInFlight = null;
    _consultSession = 0;
    _externalDrafts.clear();
    _heldExternalDrafts.clear();
    return RapiChatState(messages: [
      RapiMessage(
        id: _nextId++,
        role: RapiRole.assistant,
        text: 'ぼくは rapitas 専属のエージェント、ラピです。今日は何をしますか？'
            'やりたいことを下の欄にそのまま書いてください。'
            'タスクを作る・状況を聞く・見守りの一覧を見る、といったことも文章で頼めます。',
      ),
    ]);
  }

  // ---- 会話の操作 ----

  void _add(RapiMessage Function(int id) build) {
    state = state.copyWith(messages: [...state.messages, build(_nextId++)]);
  }

  void _system(String text, {String? taskId}) =>
      _add((id) => RapiMessage(id: id, role: RapiRole.system, text: text, taskId: taskId));

  /// 画面からの短い案内（音声入力で送らなかった理由など）を system メッセージで出す
  void notice(String text) => _system(text);

  /// 一般の会話（taskId なし）の直近 [_historyLimit] 件（今回の発言は含めない。相談スレッドは含めない）
  List<Map<String, String>> _history() =>
      _turns(state.messages.where((m) => m.consultTaskId == null));

  /// タスク [taskId] の相談スレッドの直近 [_historyLimit] 件（今回の発言は含めない）
  List<Map<String, String>> _consultHistory(String taskId) =>
      _turns(state.messages.where((m) => m.consultTaskId == taskId));

  static List<Map<String, String>> _turns(Iterable<RapiMessage> messages) {
    final turns = messages
        .where((m) => m.inHistory && m.role != RapiRole.system && m.text.isNotEmpty)
        .map((m) => {
              'role': m.role == RapiRole.user ? 'user' : 'assistant',
              'content': m.text,
            })
        .toList();
    return turns.length > _historyLimit
        ? turns.sublist(turns.length - _historyLimit)
        : turns;
  }

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
  void _holdExternalDraft(String id) {
    final i = _externalDrafts.indexWhere((d) => d.id == id);
    if (i >= 0) _heldExternalDrafts[id] = _externalDrafts.removeAt(i);
    if (state.activeExternalDraftId == id) state = state.copyWith(activeExternalDraftId: null);
  }

  /// タスク選びを待っていた依頼を、送らずに終わったので待ち行列へ戻す。
  /// [refilled] なら送れなかった文が欄に戻っているので、欄の依頼にする（送れたら消す・破棄できる）。
  /// そうでなければ最新として並べ、次に欄が空いたときに入れる
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

  // ---- 相談（consult）----
  // 振り分けが consult → 「どのタスクについて相談しますか」カード → タスクを選ぶと相談モードに入り、
  // そのタスクの過去の相談を読み込んでから、保留していた発言を最初の相談として送る。
  // 相談モード中の送信は振り分けを通さず copilot/chat（taskId 付き・履歴はそのタスクのスレッド分）へ。
  // 画面の帯の × で抜けると、通常の振り分けに戻る。

  /// 発言 [text] を保留し、タスク選びのカードを出す（発言はまだどこにも送らない）
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

  void _setPicker(int messageId, RapiConsultPicker picker) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withConsultPicker(picker) : m,
    ]);
  }

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

  // ---- タスク作成 ----

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

  // ---- 変更（change）----
  // 文 → update-draft の提案カード → 「適用する」で task-update（confirmed: true）→
  // 「取り消す」で revert。カードのボタンが確認そのもので、確認なしに書き込む道は無い。

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

  /// 適用の失敗が「書き込まれたか分からない」ものか。「適用されていない」と言い切れるのは、
  /// サーバーが 4xx（400〜499）で断った・2xx で明示的に success:false を返した・送る前に弾いた
  /// （invalid_task）・接続自体できなかった（connectionError / connectionTimeout）場合だけ。
  /// それ以外（受信・送信タイムアウト、1xx・3xx・5xx、通信の途中切れ、応答の形が読めない
  /// unexpected_response、想定外の例外）はすべて不明扱い。
  /// 3xx はリダイレクト先で処理されたかもしれず、断られたとは言えない（commit の
  /// [_commitOutcomeUnknown] と同じ線引き）。
  static bool _applyOutcomeUnknown(Object e) {
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

  // ---- 伴走（companion）----
  // 「伴走」を含む発言 → companion/draft（何も書き込まない）→ 伴走の確認カード →
  // 「伴走を始める／やめる」で start/stop（confirmed: true）。カードのボタンが確認そのもので、
  // 確認なしに書き込む道は無い（task.update の変更カードと同じ型）。
  // 相談モードの外で対象が決まらないときは、タスク選びのカード（伴走用）を挟む。

  /// 発言が伴走の依頼なら確認カード（またはタスク選び）を出して true。そうでなければ false
  /// （呼び出し側がふつうの相談・振り分けへ送る）。下書きの問い合わせ自体が失敗したときも false
  /// （伴走の見分けは入口の付け足しなので、そこで送信全体を止めない）。
  Future<bool> _offerCompanion(String text,
      {String? consultTaskId, int? userId, String? externalDraftId}) async {
    if (!rapiMentionsCompanion(text)) return false;
    final RapiCompanionDraft draft;
    try {
      draft = await ref.read(assistantServiceProvider).companionDraft(text, taskId: consultTaskId);
    } catch (_) {
      return false;
    }
    if (!draft.matched) return false;
    if (draft.needsTask) {
      if (userId == null) return false;
      _system(draft.action == RapiCompanionAction.stop ? '伴走の終了として受け取りました' : '伴走の開始として受け取りました');
      _askConsultTask(text, userId, externalDraftId: externalDraftId, companion: draft.action);
      return true;
    }
    _showCompanion(draft, consultTaskId: consultTaskId);
    return true;
  }

  /// 伴走用のタスク選びカードでタスクを選んだ：そのタスクについて下書きを聞き、確認カードを出す
  Future<void> _chooseCompanionTask(
      int messageId, RapiConsultPicker picker, RapiConsultTask task) async {
    _setPicker(messageId, picker.copyWith(phase: RapiConsultPickPhase.chosen, chosen: task));
    state = state.copyWith(sending: true);
    try {
      final draft =
          await ref.read(assistantServiceProvider).companionDraft(picker.text, taskId: task.id);
      if (draft.matched) {
        _showCompanion(draft);
      } else {
        _system('伴走の依頼として読み取れませんでした。「伴走して」「伴走をやめて」と送ってください。');
      }
      if (picker.externalDraftId != null) await _consumeExternalDraft(picker.externalDraftId!);
    } catch (e) {
      _releaseExternalDraft(picker.externalDraftId);
      _system(e is AssistantTimeoutException ? rapiTimeoutMessage : '「${task.title}」の伴走の状態を確かめられませんでした');
    } finally {
      state = state.copyWith(sending: false);
    }
    _fillNextExternalDraft();
  }

  /// 下書きを、確認カードか「今は当てはまらない」理由の返事として並べる
  void _showCompanion(RapiCompanionDraft draft, {String? consultTaskId}) {
    final proposal = draft.proposal;
    if (proposal == null) {
      _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          text: '対象のタスクを確かめられませんでした。',
          consultTaskId: consultTaskId));
      return;
    }
    final unavailable = draft.unavailable;
    if (unavailable != null) {
      _add((id) => RapiMessage(
            id: id,
            role: RapiRole.assistant,
            text: rapiCompanionUnavailableText(unavailable, proposal.title),
            consultTaskId: consultTaskId,
          ));
      return;
    }
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          companion: RapiCompanionCard(proposal: proposal),
          consultTaskId: consultTaskId,
        ));
  }

  RapiCompanionCard? _companionOf(int messageId) {
    for (final m in state.messages) {
      if (m.id == messageId) return m.companion;
    }
    return null;
  }

  void _setCompanion(int messageId, RapiCompanionCard card) {
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == messageId ? m.withCompanion(card) : m,
    ]);
  }

  /// 「やめる」：確認待ちの伴走カードを下げる（何も書き込んでいない）
  void cancelCompanion(int messageId) {
    if (_companionOf(messageId)?.phase != RapiCompanionPhase.proposed) return;
    state = state.copyWith(messages: state.messages.where((m) => m.id != messageId).toList());
  }

  /// 「伴走を始める／やめる」：カードに出ている内容をそのまま confirmed: true で送る
  Future<void> applyCompanion(int messageId) async {
    final card = _companionOf(messageId);
    if (card == null || card.phase != RapiCompanionPhase.proposed) return;
    _setCompanion(messageId, card.copyWith(phase: RapiCompanionPhase.applying, error: null));
    final p = card.proposal;
    try {
      await ref.read(assistantServiceProvider).companionApply(p.action, p.taskId);
      _refreshTask(p.taskId);
      _setCompanion(
          messageId, (_companionOf(messageId) ?? card).copyWith(phase: RapiCompanionPhase.applied));
    } catch (e) {
      final now = _companionOf(messageId) ?? card;
      if (_applyOutcomeUnknown(e)) {
        _setCompanion(messageId, now.copyWith(phase: RapiCompanionPhase.applyUnknown, error: null));
        return;
      }
      final code = e is AssistantException ? e.code : null;
      // 既にその状態になっていた（別の画面や前の押下で反映済み）なら、望んだ結果になっている
      final settled = (p.action == RapiCompanionAction.start && code == 'already_active') ||
          (p.action == RapiCompanionAction.stop && code == 'not_active');
      if (settled) {
        _setCompanion(messageId, now.copyWith(phase: RapiCompanionPhase.applied));
        return;
      }
      _setCompanion(
        messageId,
        now.copyWith(
          phase: RapiCompanionPhase.proposed,
          error: code == 'task_done'
              ? 'このタスクは完了しているため、伴走は始められません。'
              : code == 'task_not_found' || code == 'not_found'
                  ? 'このタスクが見つかりませんでした。削除された可能性があります。'
                  : 'うまくいきませんでした。もう一度試してください。',
        ),
      );
    }
  }

  // ---- 計画（roadmap）----
  // 文 → roadmap/draft の計画カード →（質問があれば）選んで「この内容で作り直す」で
  // answers 付きの再下書き → 最終確認で「この計画で作成する」→ roadmap/commit（confirmed: true）。
  // 作るのはカードに出ている下書きそのもの（画面で組み替えない）。
  // NOTE: デスクトップの締めのノートは作らない（ノートはデスクトップのブラウザ内ストレージにしか
  // 無く、サーバーに保存先が無い）。commit はノートなしで完結する。

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
      if (m.id == messageId) return m.roadmap;
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

  // ---- 片付け（tidy）----
  // 振り分けが tidy → 片付けカード。出し方は「条件で選ぶ」（delete-filter。既定、デスクトップと同じ）と
  // 「文章で選ぶ」（振り分けられた発言をそのまま delete-draft へ）。どちらも一覧を作るだけで、
  // 候補はすべてチェック済みで出す（デスクトップと同じ。外せる）。「削除する（N件）」で、
  // 出ている候補のうちチェックが残った id だけを task-delete（confirmed: true）へ50件ずつ送る。
  // 削除後は trashId ごとに task-trash/:id/restore で戻せる（1件ずつ・まとめて）。

  void _runTidy(String text) {
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, tidy: RapiTidyCard(text: text)));
  }

  RapiTidyCard? _tidyOf(int messageId) {
    for (final m in state.messages) {
      if (m.id == messageId) return m.tidy;
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
    final card = _tidyOf(messageId);
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

  // ---- 問い合わせ ----

  Future<void> _runAsk(String text) async {
    final answer = await ref.read(assistantServiceProvider).ask(text);
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, answer: answer));
  }

  // ---- 見守り ----

  /// 見守りの読み込み。読み込み中に呼ばれたら進行中のものに合流する。
  /// [propagateError] が false（カードの再読み込みボタン）なら失敗はカード内表示だけ、
  /// true（送信経由）なら失敗を呼び出し元へ投げ直す。
  Future<void> loadSurvey({bool propagateError = false}) async {
    final inFlight = _surveyInFlight ??=
        _fetchSurvey().whenComplete(() => _surveyInFlight = null);
    if (propagateError) {
      await inFlight;
      return;
    }
    try {
      await inFlight;
    } catch (_) {
      // カード内の「見に行けませんでした。」で伝える
    }
  }

  Future<void> _fetchSurvey() async {
    state = state.copyWith(surveyLoading: true, surveyFailed: false);
    try {
      final survey = await ref.read(assistantServiceProvider).getSupervision();
      state = state.copyWith(survey: survey);
    } catch (_) {
      state = state.copyWith(surveyFailed: true);
      rethrow;
    } finally {
      state = state.copyWith(surveyLoading: false);
    }
  }
}
