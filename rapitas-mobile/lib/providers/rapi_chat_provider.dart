import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/rapi.dart';
import '../models/rapi_chat/rapi_chat_cards.dart';
import '../models/rapi_chat/rapi_chat_message.dart';
import '../models/rapi_chat/rapi_tidy_state.dart';
import '../models/task.dart';
import '../services/assistant_service.dart';
import '../services/external_draft_inbox.dart';
import '../services/home_screen_bridge.dart';
import 'service_providers.dart';
import 'task_provider.dart';
import 'theme_data_provider.dart';

export '../models/rapi_chat/rapi_chat_cards.dart';
export '../models/rapi_chat/rapi_chat_message.dart';
export '../models/rapi_chat/rapi_tidy_state.dart';

part 'rapi_chat/rapi_chat_external.part.dart';
part 'rapi_chat/rapi_chat_send.part.dart';
part 'rapi_chat/rapi_chat_consult.part.dart';
part 'rapi_chat/rapi_chat_draft.part.dart';
part 'rapi_chat/rapi_chat_change.part.dart';
part 'rapi_chat/rapi_chat_companion.part.dart';
part 'rapi_chat/rapi_chat_roadmap.part.dart';
part 'rapi_chat/rapi_chat_tidy.part.dart';
part 'rapi_chat/rapi_chat_ask.part.dart';

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

/// ラピの会話の状態と処理。処理は機能ごとの mixin（rapi_chat/*.part.dart）にあり、
/// ここは土台（共有の状態・小さな補助）と build だけを持つ。
class RapiChatNotifier extends _RapiChatBase
    with _RapiExternalOps, _RapiSendOps, _RapiConsultOps, _RapiDraftOps, _RapiChangeOps, _RapiCompanionOps, _RapiRoadmapOps, _RapiTidyOps, _RapiAskOps {
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

}

/// 各 mixin が共有する状態と補助。mixin どうしで呼び合うメソッドは、ここで abstract に宣言する
abstract class _RapiChatBase extends Notifier<RapiChatState> {
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


  // ---- mixin どうしで呼び合うもの（実装は各 part）----
  // external
  Future<void> _consumeExternalDraft(String id);
  void _fillNextExternalDraft();
  void _holdExternalDraft(String id);
  void _releaseExternalDraft(String? id, {bool refilled = false});
  // send
  void _sendFailed(Object e, String text, int userId);
  // consult
  void _askConsultTask(String text, int userId,
      {String? externalDraftId, RapiCompanionAction? companion});
  void _setPicker(int messageId, RapiConsultPicker picker);
  void _closePendingPickers();
  Future<void> _sendConsult(RapiConsultTask task, String text, List<Map<String, String>> history);
  // draft
  Future<void> _runDraft(String text);
  Future<void> _reviewCriteria({
    required RapiCriteriaEdit edit,
    required String title,
    String? description,
    required RapiCriteriaEdit? Function() read,
    required void Function(RapiCriteriaEdit) write,
  });
  // change
  Future<void> _runChangeDraft(String text);
  void _refreshTask(String taskId);
  // companion
  Future<bool> _offerCompanion(String text,
      {String? consultTaskId, int? userId, String? externalDraftId});
  Future<void> _chooseCompanionTask(int messageId, RapiConsultPicker picker, RapiConsultTask task);
  // roadmap
  Future<void> _runRoadmapDraft(String text);
  // tidy
  void _runTidy(String text);
  // ask / watch
  Future<void> _runAsk(String text);
  Future<void> loadSurvey({bool propagateError = false});
}
