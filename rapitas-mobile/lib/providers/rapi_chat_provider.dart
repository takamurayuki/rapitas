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
// NOTE: モード（会話／作る／聞く／見守り）の切り替えは無い。送った文は毎回
// /assistant/route で振り分け、作成・問い合わせ・見守りはその結果で出し分ける。

enum RapiRole { user, assistant, system }

/// 会話の1件。[draftSlot] は下書きカードの置き場所、[answer] は問い合わせの回答。
class RapiMessage {
  final int id;
  final RapiRole role;
  final String text;
  final AskAnswer? answer;
  final bool draftSlot;

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
    this.taskId,
    this.inHistory = false,
  });

  RapiMessage withoutHistory() => RapiMessage(
        id: id,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        taskId: taskId,
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

/// v1 では実装していない振り分け先（デスクトップのモード名）
const Map<String, String> _desktopOnlyIntents = {
  'consult': 'このタスク',
  'tidy': '片付ける',
  'roadmap': '計画を立てる',
  'change': '変更する',
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
    state = state.copyWith(sending: true);

    try {
      await _routeAndHandle(text, history);
      // 成功したときだけ欄を空にする（失敗時は書いた文を残す）。
      // 送信中に書き足していたらそれは消さない
      if (state.input.trim() == text) state = state.copyWith(input: '');
    } catch (e) {
      final messages = [...state.messages];
      final i = messages.indexWhere((m) => m.id == userId);
      if (i >= 0) messages[i] = messages[i].withoutHistory();
      state = state.copyWith(messages: messages);
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
