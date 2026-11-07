class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? message;
  final String? link;
  final bool isRead;
  final DateTime? readAt;
  final Map<String, dynamic>? metadata;
  final DateTime createdAt;

  AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.message,
    this.link,
    this.isRead = false,
    this.readAt,
    this.metadata,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] as String,
      type: json['type'] as String,
      title: json['title'] as String,
      message: json['message'] as String?,
      link: json['link'] as String?,
      isRead: json['isRead'] as bool? ?? false,
      readAt: json['readAt'] != null
          ? DateTime.parse(json['readAt'] as String)
          : null,
      metadata: json['metadata'] != null
          ? Map<String, dynamic>.from(json['metadata'] as Map)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'title': title,
      'message': message,
      'link': link,
      'isRead': isRead,
      'readAt': readAt?.toIso8601String(),
      'metadata': metadata,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}
