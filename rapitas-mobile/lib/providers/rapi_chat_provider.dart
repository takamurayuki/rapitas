import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/rapi.dart';
import '../services/assistant_service.dart';
import 'service_providers.dart';
import 'task_provider.dart';

// ラピの会話状態。
//
// /rapi は下部タブで、タブを切り替えると RapiScreen は破棄される。会話・未送信の入力・
// 確認中の下書き・見守りの結果はここ（autoDispose しない provider）に置き、
// 画面はこれを watch して描画する。応答待ちのままタブを離れても、届いた結果は
// ここで状態へ反映するので捨てられない。
//
// NOTE: 永続化はしない。アプリを終了すると会話は消える。
// NOTE: モード（会話／作る／聞く／見守り／変更）の切り替えは無い。送った文は毎回
// /assistant/route で振り分け、作成・問い合わせ・見守り・変更はその結果で出し分ける。

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

/// 会話の1件。[draftSlot] は下書きカードの置き場所、[answer] は問い合わせの回答。
class RapiMessage {
  final int id;
  final RapiRole role;
  final String text;
  final AskAnswer? answer;
  final bool draftSlot;

  /// 変更（change）の提案カード
  final RapiChangeCard? change;

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
    this.taskId,
    this.inHistory = false,
  });

  RapiMessage withoutHistory() => RapiMessage(
        id: id,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        change: change,
        taskId: taskId,
      );

  RapiMessage withChange(RapiChangeCard change) => RapiMessage(
        id: id,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        change: change,
        taskId: taskId,
        inHistory: inHistory,
      );
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
      );

  /// 見守りカードを出すか（一度でも読み込みを始めたら一覧の先頭に出し続ける）
  bool get surveyVisible => survey != null || surveyLoading || surveyFailed;
}

/// まだモバイルで実装していない振り分け先（デスクトップのモード名）
const Map<String, String> _desktopOnlyIntents = {
  'consult': 'このタスク',
  'tidy': '片付ける',
  'roadmap': '計画を立てる',
};

/// assistant 系の要求がタイムアウトしたときの system メッセージ
const String rapiTimeoutMessage = '応答に時間がかかり、タイムアウトしました。'
    'デスクトップ側の処理が混んでいるかもしれません。もう一度送ってみてください。';

/// copilot/chat に送る履歴の件数
const int _historyLimit = 10;

final rapiChatProvider =
    NotifierProvider<RapiChatNotifier, RapiChatState>(RapiChatNotifier.new);

class RapiChatNotifier extends Notifier<RapiChatState> {
  int _nextId = 0;
  Future<void>? _surveyInFlight;

  @override
  RapiChatState build() {
    _nextId = 0;
    _surveyInFlight = null;
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

  /// 直近 [_historyLimit] 件の user / assistant の発言（今回の発言は含めない）
  List<Map<String, String>> _history() {
    final turns = state.messages
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

    final history = _history();
    final userId = _nextId;
    _add((id) => RapiMessage(id: id, role: RapiRole.user, text: text, inHistory: true));
    // 送った文は自分の発言として並ぶので、欄は送った時点で空にする（応答待ちの間も残さない）。
    // 画面は provider の input に合わせて欄を書き換えるので、タブを往復しても送った文は戻らない
    state = state.copyWith(sending: true, input: '');

    try {
      await _routeAndHandle(text, history);
    } catch (e) {
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
    } finally {
      state = state.copyWith(sending: false);
    }
  }

  Future<void> _routeAndHandle(String text, List<Map<String, String>> history) async {
    final service = ref.read(assistantServiceProvider);
    final routed = await service.routeIntent(text);

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
