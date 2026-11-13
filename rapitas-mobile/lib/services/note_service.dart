import 'package:dio/dio.dart';
import 'api_client.dart';
import '../models/note.dart';

/// ノート（資料）の API（rapitas-backend routes/memory/notes.routes.ts、prefix /notes）。
///
/// - GET /notes（任意で ?taskId=<数値>）→ {success, notes}。並びはサーバー側でピン留め優先・更新の新しい順
/// - GET /notes/:id → {success, note}。無ければ 404 {success:false, error:'note_not_found'}
///
/// - PUT /notes/:id → {success, note}。送ったフィールドだけを書く upsert（作成と更新を兼ねる）
/// - DELETE /notes/:id → {success}。紐づけもまとめて消える。無ければ 404
/// - POST /notes/:id/links {taskId(数値), meta?} → {success}。既にあれば meta を上書き
///
/// 一覧も詳細も保存の戻りも同じ形（linkedTaskIds / linkedTaskMeta を含む）なので、どれも [Note.fromJson] で読む。
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

  /// 新しいノートの id。デスクトップと同じく Date.now() 相当（ミリ秒）の文字列にする。
  ///
  /// NOTE: id はクライアントが決める（PUT /notes/:id）。サーバーで採番するとデスクトップの
  /// `/rapitas-note/{taskId}/{noteId}` 参照と形が揃わなくなるので、形はデスクトップに合わせる。
  ///
  /// @param now - 時刻（テスト用）。省略時は現在時刻
  /// @returns ノートの id
  static String newNoteId([DateTime? now]) => (now ?? DateTime.now()).millisecondsSinceEpoch.toString();

  /// ノートを保存する（無ければ作る）。null の引数は送らず、サーバー側の値をそのまま残す。
  ///
  /// v1 のモバイルはタイトルと本文だけを書く（種類・色・タグ・ピン留めは送らないので、
  /// デスクトップで付けた値が編集で消えない）。
  ///
  /// @param id - ノートの id（新規なら [newNoteId]）
  /// @param title - タイトル
  /// @param content - Markdown の本文
  /// @returns 保存後のノート
  /// @throws DioException 通信・サーバーの失敗
  Future<Note> saveNote(String id, {String? title, String? content}) async {
    final response = await _client.put(
      notePath(id),
      data: {
        if (title != null) 'title': title,
        if (content != null) 'content': content,
      },
    );
    final body = response.data;
    final note = body is Map ? body['note'] : null;
    if (note is! Map) throw StateError('ノートの保存結果を読めませんでした');
    return Note.fromJson(Map<String, dynamic>.from(note));
  }

  /// ノートをタスクに紐づける。
  ///
  /// @param id - ノートの id
  /// @param taskId - タスクの id。バックエンドは数値で受けるので数値に直して送る
  /// @param themeName - 紐づけ時の表示用情報（テーマ名）。分からなければ送らない
  /// @throws FormatException taskId が数値でない
  /// @throws DioException 通信・サーバーの失敗（ノートが無ければ 404）
  Future<void> linkNote(String id, String taskId, {String? themeName}) async {
    await _client.post(
      '${notePath(id)}/links',
      data: {
        'taskId': int.parse(taskId),
        if (themeName != null && themeName.isNotEmpty) 'meta': {'themeName': themeName},
      },
    );
  }

  /// ノートを削除する（紐づけも消える）。既に無い（404）ときも消えたものとして扱う。
  ///
  /// @param id - ノートの id
  /// @throws DioException 404 以外の通信・サーバーの失敗
  Future<void> deleteNote(String id) async {
    try {
      await _client.delete(notePath(id));
    } on DioException catch (e) {
      // 別の端末で先に消されていた。一覧から外せばよいので失敗にしない
      if (e.response?.statusCode == 404) return;
      rethrow;
    }
  }
}
