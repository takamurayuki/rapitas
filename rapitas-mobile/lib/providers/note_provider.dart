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
