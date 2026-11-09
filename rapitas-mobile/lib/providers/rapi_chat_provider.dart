import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/rapi.dart';
import '../models/task.dart';
import '../services/assistant_service.dart';
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
// NOTE: モード（会話／作る／聞く／見守り／変更／計画）の切り替えは無い。送った文は毎回
// /assistant/route で振り分け、作成・問い合わせ・見守り・変更・計画はその結果で出し分ける。
// 例外は相談（consult）：振り分けで相談になり、タスクを選ぶと「相談モード」に入る。
// 相談モード中の送信は振り分けを通さず、そのタスクの copilot/chat へ直接送る（抜けるまで）。

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

  const RapiRoadmapCard({
    required this.text,
    required this.draft,
    this.asked = const [],
    this.answers = const [],
    this.phase = RapiRoadmapPhase.ready,
    this.result,
    this.error,
  });

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
  }) =>
      RapiRoadmapCard(
        text: text,
        draft: draft ?? this.draft,
        asked: asked ?? this.asked,
        answers: answers ?? this.answers,
        phase: phase ?? this.phase,
        result: result ?? this.result,
        error: identical(error, _unset) ? this.error : error as String?,
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
      draft.steps.isNotEmpty;
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
class RapiConsultPicker {
  final String text;

  /// 選ぶ前の発言のメッセージ id（選んだら相談スレッドへ移す）
  final int utteranceId;
  final RapiConsultPickPhase phase;
  final RapiConsultTask? chosen;

  const RapiConsultPicker({
    required this.text,
    required this.utteranceId,
    this.phase = RapiConsultPickPhase.choosing,
    this.chosen,
  });

  RapiConsultPicker copyWith({RapiConsultPickPhase? phase, RapiConsultTask? chosen}) =>
      RapiConsultPicker(
        text: text,
        utteranceId: utteranceId,
        phase: phase ?? this.phase,
        chosen: chosen ?? this.chosen,
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

  /// 相談スレッドの発言なら、そのタスクの id（一般の会話の履歴には含めない）
  final String? consultTaskId;

  /// 起票したタスク（system メッセージから開ける）
  final String? taskId;

  /// copilot/chat の履歴に含めるか（挨拶・送信失敗した発言は含めない）
  final bool inHistory;

  const RapiMessage({
    required this.id,
    required this.role,
    this.text = '',
    this.answer,
    this.draftSlot = false,
    this.change,
    this.roadmap,
    this.consultPicker,
    this.consultTaskId,
    this.taskId,
    this.inHistory = false,
  });

  RapiMessage _copy({
    RapiChangeCard? change,
    RapiRoadmapCard? roadmap,
    RapiConsultPicker? consultPicker,
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
        consultTaskId: consultTaskId,
        taskId: taskId,
        inHistory: inHistory ?? this.inHistory,
      );

  RapiMessage withoutHistory() => _copy(inHistory: false);

  RapiMessage withChange(RapiChangeCard change) => _copy(change: change);

  RapiMessage withRoadmap(RapiRoadmapCard roadmap) => _copy(roadmap: roadmap);

  RapiMessage withConsultPicker(RapiConsultPicker picker) => _copy(consultPicker: picker);
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
  final bool creating;

  // 見守り（振り分けで watch になったときに読み込む）
  final SupervisionSurvey? survey;
  final bool surveyLoading;
  final bool surveyFailed;

  /// 相談モードの対象タスク（null なら通常の振り分け）。相談モード中の送信は振り分けを通さず、
  /// このタスクの copilot/chat へ直接送る
  final RapiConsultTask? consultTask;

  const RapiChatState({
    required this.messages,
    this.input = '',
    this.sending = false,
    this.draft,
    this.draftThemeId,
    this.draftTitle = '',
    this.creating = false,
    this.survey,
    this.surveyLoading = false,
    this.surveyFailed = false,
    this.consultTask,
  });

  RapiChatState copyWith({
    List<RapiMessage>? messages,
    String? input,
    bool? sending,
    Object? draft = _unset,
    Object? draftThemeId = _unset,
    String? draftTitle,
    bool? creating,
    Object? survey = _unset,
    bool? surveyLoading,
    bool? surveyFailed,
    Object? consultTask = _unset,
  }) =>
      RapiChatState(
        messages: messages ?? this.messages,
        input: input ?? this.input,
        sending: sending ?? this.sending,
        draft: identical(draft, _unset) ? this.draft : draft as TaskDraft?,
        draftThemeId:
            identical(draftThemeId, _unset) ? this.draftThemeId : draftThemeId as String?,
        draftTitle: draftTitle ?? this.draftTitle,
        creating: creating ?? this.creating,
        survey: identical(survey, _unset) ? this.survey : survey as SupervisionSurvey?,
        surveyLoading: surveyLoading ?? this.surveyLoading,
        surveyFailed: surveyFailed ?? this.surveyFailed,
        consultTask: identical(consultTask, _unset)
            ? this.consultTask
            : consultTask as RapiConsultTask?,
      );

  /// 見守りカードを出すか（一度でも読み込みを始めたら一覧の先頭に出し続ける）
  bool get surveyVisible => survey != null || surveyLoading || surveyFailed;
}

/// まだモバイルで実装していない振り分け先（デスクトップのモード名）
const Map<String, String> _desktopOnlyIntents = {
  'tidy': '片付ける',
};

/// assistant 系の要求がタイムアウトしたときの system メッセージ
const String rapiTimeoutMessage = '応答に時間がかかり、タイムアウトしました。'
    'デスクトップ側の処理が混んでいるかもしれません。もう一度送ってみてください。';

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

final rapiChatProvider =
    NotifierProvider<RapiChatNotifier, RapiChatState>(RapiChatNotifier.new);

class RapiChatNotifier extends Notifier<RapiChatState> {
  int _nextId = 0;
  Future<void>? _surveyInFlight;

  /// 相談セッションの世代。相談モードに入るたび・抜けるたびに進める。
  /// 非同期処理（履歴の読み込みなど）のあとで「まだ同じ相談が続いているか」を確かめるのに使う
  int _consultSession = 0;

  @override
  RapiChatState build() {
    _nextId = 0;
    _surveyInFlight = null;
    _consultSession = 0;
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

  /// 入力欄の文を書き戻す（画面の TextEditingController の変更から呼ぶ）
  void setInput(String text) {
    if (state.input == text) return;
    state = state.copyWith(input: text);
  }

  // ---- 送信 ----

  Future<void> send() async {
    final text = state.input.trim();
    if (text.isEmpty || state.sending) return;

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
        // 相談モード中は振り分けを通さず、そのタスクの相談として送る
        await _sendConsult(consult, text, history);
      } else {
        await _routeAndHandle(text, history, userId);
      }
    } catch (e) {
      _sendFailed(e, text, userId);
    } finally {
      state = state.copyWith(sending: false);
    }
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

  Future<void> _routeAndHandle(
      String text, List<Map<String, String>> history, int userId) async {
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
        _askConsultTask(text, userId);
      case final String intent when _desktopOnlyIntents.containsKey(intent):
        _system('「${_desktopOnlyIntents[intent]}」の操作はデスクトップ版で対応しています。'
            'デスクトップの rapitas でラピに頼んでください。');
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
  void _askConsultTask(String text, int userId) {
    // 保留した発言は一般の会話の履歴に入れない（選んだあと相談スレッドへ移す）
    state = state.copyWith(messages: [
      for (final m in state.messages) m.id == userId ? m.withoutHistory() : m,
    ]);
    _add((id) => RapiMessage(
          id: id,
          role: RapiRole.assistant,
          consultPicker: RapiConsultPicker(text: text, utteranceId: userId),
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
    if (!state.messages.any((m) => m.consultPicker?.phase == RapiConsultPickPhase.choosing)) {
      return;
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
  }

  /// タスク選びカードでタスクを選んだ：相談モードに入り、保留していた発言を送る
  Future<void> chooseConsultTask(int messageId, RapiConsultTask task) async {
    final picker = _pickerOf(messageId);
    if (picker == null || picker.phase != RapiConsultPickPhase.choosing || state.sending) {
      return;
    }
    _setPicker(messageId, picker.copyWith(phase: RapiConsultPickPhase.chosen, chosen: task));
    state = state.copyWith(consultTask: task, sending: true);
    final session = ++_consultSession;
    var userId = picker.utteranceId;
    try {
      await _loadConsultThread(task, session);
      // 履歴を待つ間に相談を終えていたら（帯の ×）、保留していた発言は送らず、何も並べない
      if (session != _consultSession) return;
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
    } catch (e) {
      _sendFailed(e, picker.text, userId);
    } finally {
      state = state.copyWith(sending: false);
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
    );
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, draftSlot: true));
  }

  void setDraftTitle(String title) {
    if (state.draftTitle == title) return;
    state = state.copyWith(draftTitle: title);
  }

  void setDraftTheme(String? themeId) => state = state.copyWith(draftThemeId: themeId);

  void discardDraft() {
    state = state.copyWith(
      messages: state.messages.where((m) => !m.draftSlot).toList(),
      draft: null,
      draftThemeId: null,
    );
  }

  Future<void> createFromDraft() async {
    final draft = state.draft;
    final themeId = state.draftThemeId;
    final title = state.draftTitle.trim();
    if (draft == null || themeId == null || title.isEmpty || state.creating) return;

    state = state.copyWith(creating: true);
    try {
      final id = await ref.read(assistantServiceProvider).createTask(
            title: title,
            themeId: themeId,
            description: draft.description,
            priority: draft.priority,
            dueDate: draft.dueDate,
            estimatedHours: draft.estimatedHours,
            acceptanceCriteria: draft.acceptanceCriteria,
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
  /// サーバーが 4xx で断った・2xx で明示的に success:false を返した・送る前に弾いた
  /// （invalid_task）・接続自体できなかった（connectionError / connectionTimeout）場合だけ。
  /// それ以外（受信・送信タイムアウト、5xx、通信の途中切れ、応答の形が読めない
  /// unexpected_response、想定外の例外）はすべて不明扱い。
  static bool _applyOutcomeUnknown(Object e) {
    if (e is AssistantException) {
      if (e.code == 'invalid_task') return false;
      final status = e.statusCode;
      return status == null || status >= 500;
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
      _setChange(
        messageId,
        (_changeOf(messageId) ?? card).copyWith(
          phase: RapiChangePhase.applied,
          error: notFound
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
      }
      if (e.statusCode == 400) return 'この変更内容は受け付けられませんでした。';
    }
    return 'うまくいきませんでした。もう一度試してください。';
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
      final result = await ref.read(assistantServiceProvider).roadmapCommit(card.draft);
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
