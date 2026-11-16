// 会話スペースに保存する1行（RapiChatMessage）の、端末側の形（設計 nav39 3.2・4.2）。
//
// PUT /rapi-chat/spaces/:id/messages の項目、保存待ちの列（SharedPreferences）の中身、
// GET の読み込み結果の3つに同じ形を使う。カードの中身は [payload]（JSON の文字列）に入る。

/// 1件の payload の上限（UTF-8 のバイト数。サーバーと同じ。設計 3.4）
const int rapiSnapshotMaxBytes = 262144;

/// 会話スペースの1行
class SavedMessage {
  final String clientId;

  /// user / assistant / system
  final String role;

  /// text / answer / change / roadmap / tidy / companion
  final String kind;
  final String text;
  final int? taskId;
  final bool inHistory;

  /// カードのスナップショット（{"v":1,"kind":...}）。本文だけの行は null
  final String? payload;
  final DateTime? clientCreatedAt;

  /// この行を消す（PUT の deleted: true）
  final bool deleted;

  /// サーバーの id（読み込んだ行だけ。並び順の正）
  final int? serverId;

  /// サーバーが保存した日時（読み込んだ行だけ）
  final DateTime? createdAt;

  const SavedMessage({
    required this.clientId,
    this.role = 'user',
    this.kind = 'text',
    this.text = '',
    this.taskId,
    this.inHistory = false,
    this.payload,
    this.clientCreatedAt,
    this.deleted = false,
    this.serverId,
    this.createdAt,
  });

  /// [clientId] の行を消す項目
  const SavedMessage.deletion(this.clientId)
      : role = 'user',
        kind = 'text',
        text = '',
        taskId = null,
        inHistory = false,
        payload = null,
        clientCreatedAt = null,
        deleted = true,
        serverId = null,
        createdAt = null;

  /// PUT の項目と、保存待ちの列に書く形
  Map<String, dynamic> toJson() => deleted
      ? {'clientId': clientId, 'deleted': true}
      : {
          'clientId': clientId,
          'role': role,
          'kind': kind,
          'text': text,
          if (taskId != null) 'taskId': taskId,
          'inHistory': inHistory,
          if (payload != null) 'payload': payload,
          if (clientCreatedAt != null) 'clientCreatedAt': clientCreatedAt!.toUtc().toIso8601String(),
        };

  /// 保存待ちの列・GET の応答の1件から読む。読めない形なら null
  static SavedMessage? tryParse(Object? json) {
    if (json is! Map) return null;
    final clientId = json['clientId'];
    if (clientId is! String) return null;
    if (json['deleted'] == true) return SavedMessage.deletion(clientId);
    DateTime? date(Object? v) => v is String ? DateTime.tryParse(v) : null;
    final taskId = json['taskId'];
    final id = json['id'];
    return SavedMessage(
      clientId: clientId,
      role: json['role'] is String ? json['role'] as String : 'system',
      kind: json['kind'] is String ? json['kind'] as String : 'text',
      text: json['text'] is String ? json['text'] as String : '',
      taskId: taskId is num ? taskId.toInt() : null,
      inHistory: json['inHistory'] == true,
      payload: json['payload'] is String ? json['payload'] as String : null,
      clientCreatedAt: date(json['clientCreatedAt']),
      serverId: id is num ? id.toInt() : null,
      createdAt: date(json['createdAt']),
    );
  }
}
