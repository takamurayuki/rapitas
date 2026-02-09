class AgentConfig {
  final String id;
  final String name;
  final String? provider;
  final String? model;
  final bool isActive;
  final DateTime createdAt;
  final DateTime updatedAt;

  AgentConfig({
    required this.id,
    required this.name,
    this.provider,
    this.model,
    this.isActive = true,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentConfig.fromJson(Map<String, dynamic> json) {
    return AgentConfig(
      id: json['id'] as String,
      name: json['name'] as String,
      provider: json['provider'] as String?,
      model: json['model'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'provider': provider,
      'model': model,
      'isActive': isActive,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}
