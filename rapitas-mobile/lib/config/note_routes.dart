import 'package:go_router/go_router.dart';
import '../screens/notes/note_detail_screen.dart';
import '../screens/notes/note_form_screen.dart';
import '../screens/notes/notes_screen.dart';
import 'note_paths.dart';

// ノート画面のルート定義。routes.dart が大きいので、ノートの分はここにまとめて展開する。

/// ノートのルート（一覧・新規・編集・詳細）。どれもシェル外の画面で push で開く。
///
/// NOTE: 並びに意味がある。'/notes/new' を '/notes/:id' より先に置く（後だと id='new' として詳細に吸われる）。
final List<GoRoute> noteRoutes = [
  GoRoute(
    path: NotePaths.list,
    builder: (context, state) => const NotesScreen(),
  ),
  GoRoute(
    path: NotePaths.create,
    builder: (context, state) =>
        NoteFormScreen(taskId: state.uri.queryParameters[NotePaths.taskIdQuery]),
  ),
  GoRoute(
    path: NotePaths.edit,
    builder: (context, state) => NoteFormScreen(noteId: state.pathParameters['id']!),
  ),
  GoRoute(
    path: NotePaths.detail,
    builder: (context, state) => NoteDetailScreen(noteId: state.pathParameters['id']!),
  ),
];

/// ディープリンクで受け付けるノートのパス（routes.dart の _knownPaths に足す）
const List<String> noteKnownPaths = [
  NotePaths.list,
  NotePaths.create,
  NotePaths.detail,
  NotePaths.edit,
];
