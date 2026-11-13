// ノート（資料）のモデル。
// 契約は rapitas-backend services/notes/note-service.ts の NoteRecord
// （GET /notes の notes[]・GET /notes/:id の note。一覧も詳細も同じ形でリンクを含む）。

/// ノートの種類。デスクトップ（rapitas-frontend stores/note-store.ts の DOC_TYPES）と同じ値で、
/// 値そのものが表示名になっている。未知の値はサーバーが受け付けるので、表示はそのまま出す。
const List<String> noteDocTypes = ['要件定義', '設計書', '議事録', '手順書', '仕様書', 'メモ'];

/// タイトルが空のノートの表示名（デスクトップの notes.untitled と同じ文言）
const String noteUntitledLabel = '(無題)';

DateTime? _localDate(dynamic value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

/// タスクから紐づけたときに保存された表示用の情報（NoteTaskLink.meta）
class NoteTaskMeta {
  final String? themeName;
  final String? projectName;
  final String? parentTaskTitle;

  const NoteTaskMeta({this.themeName, this.projectName, this.parentTaskTitle});

  factory NoteTaskMeta.fromJson(Map<String, dynamic> json) {
    String? text(dynamic v) => v is String && v.isNotEmpty ? v : null;
    return NoteTaskMeta(
      themeName: text(json['themeName']),
      projectName: text(json['projectName']),
      parentTaskTitle: text(json['parentTaskTitle']),
    );
  }
}

/// ノート1件
class Note {
  /// 文字列の id（デスクトップは Date.now() の文字列、他は cuid など）。数値に直さないこと
  final String id;
  final String title;

  /// Markdown の本文
  final String content;
  final bool isPinned;

  /// サーバーで JSON 配列から復元済みのタグ
  final List<String> tags;
  final String? color;

  /// 要件定義／設計書／議事録／手順書／仕様書／メモ。未設定は null
  final String? docType;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// 紐づいているタスクの id（モバイルの Task.id に合わせて文字列で持つ）
  final List<String> linkedTaskIds;

  /// タスク id → 紐づけ時の表示用情報（無いタスクは載らない）
  final Map<String, NoteTaskMeta> linkedTaskMeta;

  const Note({
    required this.id,
    required this.title,
    required this.content,
    this.isPinned = false,
    this.tags = const [],
    this.color,
    this.docType,
    this.createdAt,
    this.updatedAt,
    this.linkedTaskIds = const [],
    this.linkedTaskMeta = const {},
  });

  /// 一覧・詳細で見せる名前。空のタイトルは「(無題)」
  String get displayTitle => title.trim().isEmpty ? noteUntitledLabel : title;

  factory Note.fromJson(Map<String, dynamic> json) {
    final tags = json['tags'];
    final ids = json['linkedTaskIds'];
    final meta = json['linkedTaskMeta'];
    String? text(dynamic v) => v is String && v.isNotEmpty ? v : null;
    return Note(
      id: json['id'].toString(),
      title: json['title']?.toString() ?? '',
      content: json['content']?.toString() ?? '',
      isPinned: json['isPinned'] == true,
      tags: tags is List ? tags.map((t) => t.toString()).toList() : const [],
      color: text(json['color']),
      docType: text(json['docType']),
      // サーバーは UTC の ISO 文字列で返す。表示は端末の時刻にする
      createdAt: _localDate(json['createdAt']),
      updatedAt: _localDate(json['updatedAt']),
      linkedTaskIds: ids is List ? ids.map((id) => id.toString()).toList() : const [],
      // NOTE: JSON のキーは文字列になる（サーバーの Record<number, …> も "12" で届く）
      linkedTaskMeta: meta is Map
          ? {
              for (final entry in meta.entries)
                if (entry.value is Map)
                  entry.key.toString():
                      NoteTaskMeta.fromJson(Map<String, dynamic>.from(entry.value as Map)),
            }
          : const {},
    );
  }
}
