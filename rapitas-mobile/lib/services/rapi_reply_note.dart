import '../models/rapi_chat/rapi_chat_message.dart';
import 'note_service.dart';

// ラピの文章の返答をノートにする：タイトルと本文（質問と回答の Markdown）の組み立てと、保存・紐付け。
// 書き込みは既存の NoteService（PUT /notes/:id・POST /notes/:id/links）を使う。
// ボタンの見た目・保存済みの状態・スナックバーは持たない（rapi_reply_note_button.dart）。

/// タイトルをこの字数で切って「…」を付ける
const int rapiNoteTitleMax = 30;

/// 質問も返答の1行目も取れないときのタイトル
const String rapiNoteFallbackTitle = 'ラピとの会話';

/// 1回のやりとりから作るノートの中身
class RapiReplyNoteDraft {
  final String title;

  /// Markdown の本文
  final String content;

  const RapiReplyNoteDraft({required this.title, required this.content});
}

/// 保存の結果。[linked] は紐付ける先が無ければ null、紐付けに失敗したら false
class RapiReplyNoteSaved {
  final String noteId;
  final bool? linked;

  const RapiReplyNoteSaved({required this.noteId, this.linked});
}

/// 空でない最初の行（先頭の Markdown の記号 # > - * を落とす）
String _firstLine(String text) {
  for (final raw in text.split('\n')) {
    final line = raw.replaceFirst(RegExp(r'^[\s#>*-]+'), '').trim();
    if (line.isNotEmpty) return line;
  }
  return '';
}

String _shorten(String line) {
  // NOTE: 絵文字などを途中で切らないよう、UTF-16 の単位ではなく文字（rune）で数える
  final runes = line.runes.toList();
  return runes.length > rapiNoteTitleMax
      ? '${String.fromCharCodes(runes.take(rapiNoteTitleMax))}…'
      : line;
}

/// 質問とラピの返答からノートを組み立てる。
///
/// @param question - 返答の直前のユーザーの発言。取れなければ null
/// @param answer - ラピの返答（Markdown のまま）
/// @returns タイトルと本文
RapiReplyNoteDraft buildRapiReplyNote(String? question, String answer) {
  final asked = question?.trim() ?? '';
  final line = _firstLine(asked).isNotEmpty ? _firstLine(asked) : _firstLine(answer);
  final sections = [
    if (asked.isNotEmpty) ...['## 質問', asked],
    '## ラピの回答',
    answer.trim(),
  ];
  return RapiReplyNoteDraft(
    title: line.isEmpty ? rapiNoteFallbackTitle : _shorten(line),
    content: '${sections.join('\n\n')}\n',
  );
}

/// 返答 [reply] が答えている発言：同じ会話（一般／同じタスクの相談）の中で、直前のユーザーの発言。
///
/// @param messages - 会話の行（並び順）
/// @param reply - ラピの返答
/// @returns 発言の文。無ければ null
String? rapiQuestionBefore(List<RapiMessage> messages, RapiMessage reply) {
  final index = messages.indexWhere((m) => m.id == reply.id);
  for (var i = index - 1; i >= 0; i--) {
    final m = messages[i];
    if (m.role == RapiRole.user && m.consultTaskId == reply.consultTaskId) return m.text;
  }
  return null;
}

/// ノートを保存し、[taskId] があればそのタスクへ紐付ける。
///
/// 紐付けの失敗はノートの保存の失敗にしない（ノートはもうあるので、結果の linked=false で知らせる）。
///
/// @param service - ノートの API
/// @param draft - タイトルと本文
/// @param taskId - 相談中のタスクの id。一般の会話なら null
/// @param now - id に使う時刻（テスト用）
/// @returns ノートの id と紐付けの成否
/// @throws Object ノート自体を保存できなかった（呼び出し側は成功と出さない）
Future<RapiReplyNoteSaved> saveRapiReplyNote(
  NoteService service,
  RapiReplyNoteDraft draft, {
  String? taskId,
  DateTime? now,
}) async {
  final id = NoteService.newNoteId(now);
  await service.saveNote(id, title: draft.title, content: draft.content);
  if (taskId == null) return RapiReplyNoteSaved(noteId: id);
  try {
    await service.linkNote(id, taskId);
    return RapiReplyNoteSaved(noteId: id, linked: true);
  } catch (_) {
    return RapiReplyNoteSaved(noteId: id, linked: false);
  }
}
