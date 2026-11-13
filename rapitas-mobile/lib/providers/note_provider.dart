import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/note.dart';
import 'service_providers.dart';

/// タスクに紐づくノート（タスク詳細の「資料」節）。引数はタスクの id。
///
/// ノートを作成・編集・削除したら、そのタスクの分をここで invalidate すること。
final taskNotesProvider = FutureProvider.autoDispose.family<List<Note>, String>((ref, taskId) {
  return ref.watch(noteServiceProvider).getNotes(taskId: taskId);
});

/// ノート1件（ノート詳細画面）。見つからないときは null。
final noteDetailProvider = FutureProvider.autoDispose.family<Note?, String>((ref, id) {
  return ref.watch(noteServiceProvider).getNote(id);
});

/// 全ノート（ノート一覧画面）。並びはサーバーのまま（ピン留め優先・更新の新しい順）。
final noteListProvider = FutureProvider.autoDispose<List<Note>>((ref) {
  return ref.watch(noteServiceProvider).getNotes();
});

/// ノートを作成・編集・削除した後に、そのノートが出ている画面の読み込みをやり直させる。
///
/// @param container - 画面が閉じた後でも使えるよう、呼び出し側で先に取っておいたもの
/// @param noteId - 書き換えたノートの id
/// @param taskIds - そのノートが紐づいている（紐づいていた）タスクの id。資料節を読み直す
void invalidateNoteCaches(ProviderContainer container, String noteId, Iterable<String> taskIds) {
  container.invalidate(noteListProvider);
  container.invalidate(noteDetailProvider(noteId));
  for (final taskId in taskIds) {
    container.invalidate(taskNotesProvider(taskId));
  }
}
