// ラピの「確認済み」スタンプの規則：意図ごとの字と、読み込んだ記録への印の戻し方。
//
// 印は「ラピがその発言を読み取り、処理を始めた」ことを表す（LINE の既読に近い）。いまの会話では、
// 振り分けの結果が返った時点で provider が発言に意図を書き込む（RapiMessage.readAs）。印は保存しない
// ので、会話スペースから読み込んだ記録は、後ろに続く応答の有無と種類から戻す（rapiRestoreReadMarks）。
//
// NOTE: 字の規則はデスクトップ rapitas-frontend/src/components/ui/chat/read-stamp.ts と同じ。
// 片方を変えたらもう片方も変える（意図の一覧・字・振り分けの案内の名前）。
//   引き受けて実行する（create・roadmap・change・tidy・companion）→ 🫡
//   見守り（watch）→ 👀
//   答える・聞く（ask・consult・chat・不明）→ 👌

import 'rapi_chat_message.dart';

/// 引き受けて実行する系の字
const String rapiStampOnIt = '🫡';

/// 見守りの字
const String rapiStampWatching = '👀';

/// 答える・聞く系の字（不明のときもこれ）
const String rapiStampOk = '👌';

/// 会話（振り分けられなかった・chat）の意図
const String rapiIntentChat = 'chat';

/// 伴走の依頼（振り分けを通らない入口）の意図
const String rapiIntentCompanion = 'companion';

/// 意図 [intent] のスタンプの字。
///
/// @param intent - 振り分け先（null・知らない値は答える系として扱う） / 発言の意図
/// @returns スタンプの字 / 字
String rapiStampGlyphFor(String? intent) => switch (intent) {
      'create' || 'roadmap' || 'change' || 'tidy' || rapiIntentCompanion => rapiStampOnIt,
      'watch' => rapiStampWatching,
      _ => rapiStampOk,
    };

/// 振り分けの案内（「〇〇として受け取りました」）に出す名前（モバイルが今も保存している形）
const Map<String, String> rapiRoutedLabels = {
  'create': 'タスク作成',
  'ask': 'タスクへの問い合わせ',
  'watch': '見守り',
  'change': 'タスクの変更',
  'roadmap': '計画づくり',
  'consult': 'タスクについての相談',
  'tidy': 'タスクの片付け',
};

/// 案内の名前 → 意図。モバイルの名前に加え、伴走の案内と、デスクトップが #1543 より前に保存した
/// 案内（「タスクを作る」・英語の “Add a task” など、rapiAvatar.mode の文言）も引けるようにする
final Map<String, String> _intentByLabel = {
  for (final e in rapiRoutedLabels.entries) e.value: e.key,
  '伴走の開始': rapiIntentCompanion,
  '伴走の終了': rapiIntentCompanion,
  '対話': rapiIntentChat, '要対応': 'watch', 'タスクを作る': 'create', 'タスクを探す': 'ask',
  'このタスク': 'consult', '片付ける': 'tidy', '計画を立てる': 'roadmap', '変更する': 'change',
  'Talk': rapiIntentChat, 'Needs you': 'watch', 'Add a task': 'create', 'Find tasks': 'ask',
  'This task': 'consult', 'Tidy up': 'tidy', 'Plan it out': 'roadmap', 'Change': 'change',
};

final RegExp _routingNote =
    RegExp(r'^(?:「([^」]+)」|([^「」—]+?))として受け取りました|^Took that as “([^”]+)”');

/// 振り分けの案内 [text] が示す意図。案内でなければ null。
///
/// @param text - system 行の本文 / 本文
/// @returns 意図（create など） / 意図
String? rapiIntentOfRoutingNote(String text) {
  final m = _routingNote.firstMatch(text);
  if (m == null) return null;
  final label = m.group(1) ?? m.group(2) ?? m.group(3);
  return _intentByLabel[label?.trim()];
}

/// 送信の失敗を伝える案内（この案内があるターンの発言には印を戻さない）
const String rapiSendFailedText = '送信に失敗しました';

/// assistant 系の要求がタイムアウトしたときの system メッセージ
const String rapiTimeoutMessage = '応答に時間がかかり、タイムアウトしました。'
    'デスクトップ側の処理が混んでいるかもしれません。もう一度送ってみてください。';

/// 記録の行 [m] が、そのターンの意図を示していればその意図。
String? _intentOfLine(RapiMessage m) {
  if (m.role == RapiRole.system) {
    final routed = rapiIntentOfRoutingNote(m.text);
    if (routed != null) return routed;
    // 起票済みの案内（「〇〇」を起票しました）はタスクを開ける行として残っている
    if (m.taskId != null) return 'create';
    return null;
  }
  if (m.answer != null) return 'ask';
  if (m.change != null || m.criteria != null) return 'change';
  if (m.roadmap != null) return 'roadmap';
  if (m.tidy != null) return 'tidy';
  if (m.companion != null) return rapiIntentCompanion;
  if (m.role == RapiRole.assistant && m.text.isNotEmpty) return rapiIntentChat;
  return null;
}

/// 読み込んだ記録（archived）のユーザーの発言に、確認の印を戻す。
///
/// 発言のターン（次のユーザーの発言の手前まで）を見て、送信失敗の案内が無く、かつ
/// (a) ラピ側の行（返答・カード・案内）がある、または (b) 履歴に入ったまま（inHistory）次の発言が
/// 続いている（送信中は次を送れず、失敗すると履歴から外れるので、応答が保存されない種類のターンでも
/// 終わっていたと分かる）なら確認済みとする。字はターンの行から意図を戻し、戻せなければ会話（👌）。
/// 末尾の発言で応答が保存されていなければ付けない。いまのセッションの行と、既に印のある行は変えない。
///
/// @param messages - 画面に並べる行（並び順のまま） / 会話の行
/// @returns 印を戻した行の一覧 / 印を戻した一覧
List<RapiMessage> rapiRestoreReadMarks(List<RapiMessage> messages) {
  final out = [...messages];
  for (var i = 0; i < out.length; i++) {
    final u = out[i];
    if (u.role != RapiRole.user || !u.archived || u.readAs != null) continue;
    var failed = false;
    var answered = false;
    var followed = false;
    String? intent;
    for (var j = i + 1; j < out.length; j++) {
      final m = out[j];
      if (m.role == RapiRole.user) {
        followed = true;
        break;
      }
      if (m.role == RapiRole.system && (m.text == rapiSendFailedText || m.text == rapiTimeoutMessage)) {
        failed = true;
      }
      answered = true;
      intent ??= _intentOfLine(m);
    }
    if (failed || !(answered || (u.inHistory && followed))) continue;
    out[i] = u.withReadAs(intent ?? rapiIntentChat);
  }
  return out;
}
