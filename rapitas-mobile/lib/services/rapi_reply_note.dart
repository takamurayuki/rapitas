import 'note_service.dart';

// ラピの文章の返答をノートにする：下書きの生成（POST /notes/draft-from-reply）→ 保存（PUT /notes/:id）
// → タスクへの紐付け（POST /notes/:id/links）の順に、既存の NoteService で行う。
// ボタンの見た目・保存済みの状態・スナックバーは持たない（rapi_reply_note_button.dart）。
//
// NOTE: 以前は端末で「## 質問」「## ラピの回答」の枠と質問の1行目のタイトルを組み立てていた（nav66）。
// nav70 で、回答だけをサーバーが整えた文書とタイトルで保存するように変えたので、質問は集めも送りもしない。

/// 保存の結果。[linked] は紐付ける先が無ければ null、紐付けに失敗したら false
class RapiReplyNoteSaved {
  final String noteId;
  final bool? linked;

  const RapiReplyNoteSaved({required this.noteId, this.linked});
}

/// ラピの返答をノートとして保存し、[taskId] があればそのタスクへ紐付ける。
///
/// 下書きの生成に失敗したら保存しない（整えていない本文で保存する代わりの経路は持たない）。
/// 紐付けの失敗はノートの保存の失敗にしない（ノートはもうあるので、結果の linked=false で知らせる）。
///
/// @param service - ノートの API
/// @param answer - ラピの返答（Markdown のまま）
/// @param taskId - 相談中のタスクの id。一般の会話なら null
/// @param now - id に使う時刻（テスト用）
/// @returns ノートの id と紐付けの成否
/// @throws Object 下書きを作れなかった、またはノート自体を保存できなかった（呼び出し側は成功と出さない）
Future<RapiReplyNoteSaved> saveRapiReplyNote(
  NoteService service,
  String answer, {
  String? taskId,
  DateTime? now,
}) async {
  final draft = await service.draftFromReply(answer);
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
