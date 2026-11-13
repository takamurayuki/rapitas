import 'package:rapitas_mobile/models/note.dart';
import 'package:rapitas_mobile/services/note_service.dart';

// ノート画面のテスト・画面キャプチャ用の、手元の一覧で動く NoteService。
// 中身はすべてダミーデータ（実在のノートではない）。

/// 手元の [notes] を読み書きし、書き込みを [calls] に記録する NoteService。
class FakeNoteService implements NoteService {
  final List<Note> notes;

  /// 書き込みの記録（`save:id:title:content`、`link:id:taskId:themeName`、`delete:id`）
  final List<String> calls = [];

  bool failSave = false;
  bool failLink = false;
  bool failDelete = false;

  FakeNoteService([List<Note>? notes]) : notes = notes ?? [];

  @override
  Future<List<Note>> getNotes({String? taskId}) async => [
        for (final n in notes)
          if (taskId == null || n.linkedTaskIds.contains(taskId)) n,
      ];

  @override
  Future<Note?> getNote(String id) async {
    for (final n in notes) {
      if (n.id == id) return n;
    }
    return null;
  }

  @override
  Future<Note> saveNote(String id, {String? title, String? content}) async {
    calls.add('save:$id:$title:$content');
    if (failSave) throw Exception('保存エラー');
    final index = notes.indexWhere((n) => n.id == id);
    final old = index < 0 ? null : notes[index];
    final saved = Note(
      id: id,
      title: title ?? old?.title ?? '',
      content: content ?? old?.content ?? '',
      isPinned: old?.isPinned ?? false,
      tags: old?.tags ?? const [],
      docType: old?.docType,
      updatedAt: DateTime(2026, 11, 13, 12),
      linkedTaskIds: old?.linkedTaskIds ?? const [],
    );
    if (index < 0) {
      notes.add(saved);
    } else {
      notes[index] = saved;
    }
    return saved;
  }

  @override
  Future<void> linkNote(String id, String taskId, {String? themeName}) async {
    calls.add('link:$id:$taskId:$themeName');
    if (failLink) throw Exception('紐づけエラー');
    final index = notes.indexWhere((n) => n.id == id);
    final n = notes[index];
    notes[index] = Note(
      id: n.id,
      title: n.title,
      content: n.content,
      isPinned: n.isPinned,
      tags: n.tags,
      docType: n.docType,
      updatedAt: n.updatedAt,
      linkedTaskIds: [...n.linkedTaskIds, taskId],
    );
  }

  @override
  Future<void> deleteNote(String id) async {
    calls.add('delete:$id');
    if (failDelete) throw Exception('サーバーエラー');
    notes.removeWhere((n) => n.id == id);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 一覧・キャプチャ用のダミーのノート（サーバーの並び＝ピン留め優先・更新の新しい順）
List<Note> dummyNotes() => [
      Note(
        id: '1731400000001',
        title: '【ダミー】ノート機能 v1 の画面設計',
        content: '# 画面設計\n- 一覧はサーバーの並びのまま\n- 削除は横スワイプ\n\n```mermaid\ngraph TD; A-->B\n```',
        isPinned: true,
        tags: const ['設計', 'mobile'],
        docType: '設計書',
        updatedAt: DateTime(2026, 11, 13, 9, 30),
        linkedTaskIds: const ['101'],
        linkedTaskMeta: const {'101': NoteTaskMeta(themeName: 'ダミーテーマ', projectName: 'ダミー')},
      ),
      Note(
        id: '1731400000002',
        title: '【ダミー】定例の議事録',
        content: '## 決まったこと\n1. 資料セクションをタスク詳細に置く\n2. 編集はタイトルと本文だけ',
        docType: '議事録',
        updatedAt: DateTime(2026, 11, 12, 18, 5),
      ),
      Note(
        id: '1731400000003',
        title: '',
        content: '> タイトルの無いダミーのメモ\n本文だけのノート',
        docType: 'メモ',
        updatedAt: DateTime(2026, 11, 10, 8),
        linkedTaskIds: const ['101', '102'],
      ),
    ];
