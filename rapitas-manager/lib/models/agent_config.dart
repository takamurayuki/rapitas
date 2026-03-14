class AgentConfig {
  final String id;
  final String name;
  final String? agentType;
  final String? provider;
  final String? model;
  final String? endpoint;
  final bool isActive;
  final bool isDefault;
  final bool hasApiKey;
  final String? maskedApiKey;
  final DateTime createdAt;
  final DateTime updatedAt;

  AgentConfig({
    required this.id,
    required this.name,
    this.agentType,
    this.provider,
    this.model,
    this.endpoint,
    this.isActive = true,
    this.isDefault = false,
    this.hasApiKey = false,
    this.maskedApiKey,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentConfig.fromJson(Map<String, dynamic> json) {
    return AgentConfig(
      id: json['id'].toString(),
      name: json['name'] as String,
      agentType: json['agentType'] as String?,
      provider: json['provider'] as String?,
      model: json['modelId'] as String? ?? json['model'] as String?,
      endpoint: json['endpoint'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      isDefault: json['isDefault'] as bool? ?? false,
      hasApiKey: json['hasApiKey'] as bool? ?? json['apiKeyEncrypted'] != null,
      maskedApiKey:
          json['maskedApiKey'] as String? ?? json['apiKeyMasked'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'agentType': agentType,
      'provider': provider,
      'modelId': model,
      'endpoint': endpoint,
      'isActive': isActive,
      'isDefault': isDefault,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  String get displayProvider => agentType ?? provider ?? 'Unknown';

  String get displayModel => model ?? 'デフォルト';

  IconLabel get providerIcon {
    switch ((agentType ?? provider ?? '').toLowerCase()) {
      case 'claude':
      case 'anthropic':
        return const IconLabel('Anthropic Claude', '🟣');
      case 'chatgpt':
      case 'openai':
        return const IconLabel('OpenAI ChatGPT', '🟢');
      case 'gemini':
      case 'google':
        return const IconLabel('Google Gemini', '🔵');
      default:
        return const IconLabel('AI Agent', '🤖');
    }
  }
}

class IconLabel {
  final String label;
  final String emoji;

  const IconLabel(this.label, this.emoji);
}
