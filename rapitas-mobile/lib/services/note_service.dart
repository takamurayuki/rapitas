import 'package:dio/dio.dart';
import 'api_client.dart';
import '../models/note.dart';

/// ノート（資料）の API（rapitas-backend routes/memory/notes.routes.ts、prefix /notes）。
///
/// - GET /notes（任意で ?taskId=<数値>）→ {success, notes}。並びはサーバー側でピン留め優先・更新の新しい順
/// - GET /notes/:id → {success, note}。無ければ 404 {success:false, error:'note_not_found'}
///
/// 一覧も詳細も同じ形（linkedTaskIds / linkedTaskMeta を含む）なので、どちらも [Note.fromJson] で読む。
/// 書き込み（PUT /notes/:id の upsert、DELETE、POST /notes/:id/links）はノートの作成・編集と合わせて足す。
class NoteService {
  final ApiClient _client;

  NoteService(this._client);

  /// ノートの id をパスに入れる形にする。id は呼び出し側が決めた文字列なので念のため符号化する
  static String notePath(String id) => '/notes/${Uri.encodeComponent(id)}';

  /// ノート一覧。[taskId] を渡すとそのタスクに紐づくノートだけを返す。
  ///
  /// @param taskId - タスクの id（バックエンドは文字列で受けて数値に直す）。null なら全件
  /// @returns サーバーの並び（ピン留め優先・更新の新しい順）のままのノート
  Future<List<Note>> getNotes({String? taskId}) async {
    final response = await _client.get(
      '/notes',
      queryParameters: taskId == null ? null : {'taskId': taskId},
    );
    final body = response.data;
    final list = body is Map ? body['notes'] : null;
    if (list is! List) return const [];
    return list
        .whereType<Map>()
        .map((e) => Note.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// ノート1件。消されたなど見つからないときは null（他の失敗はそのまま投げる）。
  ///
  /// @param id - ノートの id
  /// @returns ノート。404 なら null
  Future<Note?> getNote(String id) async {
    try {
      final response = await _client.get(notePath(id));
      final body = response.data;
      final note = body is Map ? body['note'] : null;
      if (note is! Map) return null;
      return Note.fromJson(Map<String, dynamic>.from(note));
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }
}
