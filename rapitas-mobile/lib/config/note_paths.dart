// ノート画面のパス。
//
// NOTE: routes.dart → 各画面 → routes.dart の import の循環を作らないよう、ノートの画面・部品は
// routes.dart ではなくこのファイルからパスを取る（このファイルは何も import しない）。

/// ノート画面（一覧・新規・詳細・編集）のパス
class NotePaths {
  NotePaths._();

  /// ノート一覧（ドロワーから開く）
  static const String list = '/notes';

  /// 新規作成。`?taskId=` 付きなら保存後にそのタスクへ紐づける。
  /// NOTE: routes では '/notes/:id' より先に宣言する（後だと id='new' として詳細に吸われる）
  static const String create = '/notes/new';

  /// ノート詳細
  static const String detail = '/notes/:id';

  /// 既存ノートの編集
  static const String edit = '/notes/:id/edit';

  /// 新規作成で紐づけ先のタスクを渡すクエリ名
  static const String taskIdQuery = 'taskId';

  /// 新規作成へのパス。
  ///
  /// @param taskId - 保存後に紐づけるタスクの id。null なら紐づけない
  /// @returns パス（クエリ込み）
  static String createPath({String? taskId}) =>
      taskId == null ? create : Uri(path: create, queryParameters: {taskIdQuery: taskId}).toString();

  /// ノート詳細へのパス。id はサーバーが受ける任意の文字列なので符号化する
  static String detailPath(String id) => '/notes/${Uri.encodeComponent(id)}';

  /// ノート編集へのパス
  static String editPath(String id) => '${detailPath(id)}/edit';
}
