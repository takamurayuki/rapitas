// ラピの会話の1件（RapiMessage）、相談のタスク選び、会話全体の状態（RapiChatState）。
//
// NOTE: provider の分割（nav39 v1-0a）で rapi_chat_provider.dart から移した。挙動は変えていない。

import '../rapi.dart';
import 'rapi_chat_cards.dart';
import 'rapi_tidy_state.dart';

enum RapiRole { user, assistant, system }

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

  /// 会話スペースに保存する行の鍵（読み込んだ記録はサーバーの値。いまのセッションの行は null で、
  /// 保存のときに provider が端末内の id から決める。設計 nav39 4.2）
  final String? clientId;

  /// 会話スペースから読み込んだ記録か。記録は読み取り専用で、カードの操作は効かない（設計 5.3.1）
  final bool archived;

  /// 記録を保存した日時（[archived] のときだけ。カードの「記録」の印に出す）
  final DateTime? savedAt;

  /// 記録の形が新しすぎる・知らない種類で、カードを出せない（本文だけを出す。設計 3.4）
  final bool unsupported;

  /// 端末だけの行（挨拶・保存の失敗の案内など）。会話スペースには保存しない（設計 6.1・4.4）
  final bool localOnly;

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
    this.clientId,
    this.archived = false,
    this.savedAt,
    this.unsupported = false,
    this.localOnly = false,
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
        clientId: clientId,
        archived: archived,
        savedAt: savedAt,
        unsupported: unsupported,
        localOnly: localOnly,
      );

  /// 同じ中身で端末内の id だけを [newId] にした行（読み込んだ記録に新しい id を振るとき）
  RapiMessage withId(int newId) => RapiMessage(
        id: newId,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        change: change,
        roadmap: roadmap,
        consultPicker: consultPicker,
        tidy: tidy,
        companion: companion,
        consultTaskId: consultTaskId,
        taskId: taskId,
        inHistory: inHistory,
        externalDraftId: externalDraftId,
        clientId: clientId,
        archived: archived,
        savedAt: savedAt,
        unsupported: unsupported,
        localOnly: localOnly,
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
