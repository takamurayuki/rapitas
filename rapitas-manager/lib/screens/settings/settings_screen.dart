import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/agent_config.dart';
import '../../providers/agent_provider.dart';
import '../../providers/settings_provider.dart';
import '../../providers/service_providers.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final backendUrl = ref.watch(backendUrlProvider);
    final agentConfigsAsync = ref.watch(agentConfigsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('設定'),
      ),
      body: ListView(
        children: [
          const _SectionTitle('接続設定'),
          ListTile(
            leading: const Icon(Icons.link),
            title: const Text('バックエンドURL'),
            subtitle: Text(backendUrl),
            trailing: const Icon(Icons.edit),
            onTap: () => _editBackendUrl(context, ref, backendUrl),
          ),
          ListTile(
            leading: const Icon(Icons.wifi),
            title: const Text('接続テスト'),
            trailing: const Icon(Icons.play_arrow),
            onTap: () => _testConnection(context, ref),
          ),
          const Divider(),
          const _SectionTitle('APIキー設定'),
          agentConfigsAsync.when(
            data: (configs) => configs.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'エージェント設定がありません。バックエンドで設定を追加してください。',
                      style: TextStyle(color: Colors.grey),
                    ),
                  )
                : _AgentConfigAccordion(configs: configs),
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(
                    '設定の取得に失敗しました',
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () =>
                        ref.read(agentConfigsProvider.notifier).refresh(),
                    icon: const Icon(Icons.refresh),
                    label: const Text('再読み込み'),
                  ),
                ],
              ),
            ),
          ),
          const Divider(),
          const _SectionTitle('表示設定'),
          ListTile(
            leading: const Icon(Icons.brightness_6),
            title: const Text('テーマ'),
            subtitle: Text(_themeLabel(themeMode)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _selectTheme(context, ref, themeMode),
          ),
          const Divider(),
          const _SectionTitle('情報'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('バージョン'),
            subtitle: Text('1.0.0'),
          ),
          const ListTile(
            leading: Icon(Icons.code),
            title: Text('アプリ名'),
            subtitle: Text('Rapitas Manager'),
          ),
        ],
      ),
    );
  }

  String _themeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'ライト';
      case ThemeMode.dark:
        return 'ダーク';
      case ThemeMode.system:
        return 'システム設定に従う';
    }
  }

  void _editBackendUrl(BuildContext context, WidgetRef ref, String currentUrl) {
    final controller = TextEditingController(text: currentUrl);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('バックエンドURL'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'URL',
            hintText: 'http://192.168.1.100:3001',
          ),
          keyboardType: TextInputType.url,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () {
              final url = controller.text.trim();
              if (url.isNotEmpty) {
                ref.read(backendUrlProvider.notifier).setUrl(url);
                ref.read(apiConfigProvider).baseUrl = url;
                ref.read(apiClientProvider).updateBaseUrl(url);
                Navigator.pop(context);
              }
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }

  Future<void> _testConnection(BuildContext context, WidgetRef ref) async {
    try {
      final client = ref.read(apiClientProvider);
      await client.get('/settings');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('接続成功'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('接続失敗: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _selectTheme(BuildContext context, WidgetRef ref, ThemeMode current) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('テーマ選択'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioListTile<ThemeMode>(
              value: ThemeMode.system,
              groupValue: current,
              title: const Text('システム設定に従う'),
              onChanged: (mode) {
                ref.read(themeModeProvider.notifier).setThemeMode(mode!);
                Navigator.pop(context);
              },
            ),
            RadioListTile<ThemeMode>(
              value: ThemeMode.light,
              groupValue: current,
              title: const Text('ライト'),
              onChanged: (mode) {
                ref.read(themeModeProvider.notifier).setThemeMode(mode!);
                Navigator.pop(context);
              },
            ),
            RadioListTile<ThemeMode>(
              value: ThemeMode.dark,
              groupValue: current,
              title: const Text('ダーク'),
              onChanged: (mode) {
                ref.read(themeModeProvider.notifier).setThemeMode(mode!);
                Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _AgentConfigAccordion extends ConsumerStatefulWidget {
  final List<AgentConfig> configs;

  const _AgentConfigAccordion({required this.configs});

  @override
  ConsumerState<_AgentConfigAccordion> createState() =>
      _AgentConfigAccordionState();
}

class _AgentConfigAccordionState extends ConsumerState<_AgentConfigAccordion> {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ExpansionPanelList.radio(
      elevation: 1,
      expandedHeaderPadding: const EdgeInsets.symmetric(vertical: 4),
      children: widget.configs.map((config) {
        final providerInfo = config.providerIcon;
        return ExpansionPanelRadio(
          value: config.id,
          canTapOnHeader: true,
          headerBuilder: (context, isExpanded) {
            return ListTile(
              leading: CircleAvatar(
                backgroundColor: _providerColor(config).withValues(alpha: 0.15),
                child: Text(
                  providerInfo.emoji,
                  style: const TextStyle(fontSize: 18),
                ),
              ),
              title: Text(
                config.name,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(config.displayProvider),
              trailing: config.hasApiKey
                  ? Icon(Icons.check_circle, color: Colors.green[600], size: 20)
                  : Icon(Icons.warning_amber, color: Colors.orange[700], size: 20),
            );
          },
          body: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _InfoRow(
                  label: 'プロバイダー',
                  value: config.displayProvider,
                ),
                _InfoRow(
                  label: 'モデル',
                  value: config.displayModel,
                ),
                if (config.endpoint != null)
                  _InfoRow(
                    label: 'エンドポイント',
                    value: config.endpoint!,
                  ),
                _InfoRow(
                  label: 'APIキー',
                  value: config.hasApiKey
                      ? config.maskedApiKey ?? '設定済み'
                      : '未設定',
                  valueColor: config.hasApiKey ? Colors.green[700] : Colors.orange[700],
                ),
                _InfoRow(
                  label: 'ステータス',
                  value: config.isActive ? '有効' : '無効',
                  valueColor: config.isActive ? Colors.green[700] : Colors.grey,
                ),
                if (config.isDefault)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Chip(
                      label: const Text('デフォルト'),
                      backgroundColor:
                          theme.colorScheme.primaryContainer,
                      labelStyle: TextStyle(
                        color: theme.colorScheme.onPrimaryContainer,
                        fontSize: 12,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            _showApiKeyDialog(context, ref, config),
                        icon: Icon(
                          config.hasApiKey ? Icons.edit : Icons.add,
                          size: 18,
                        ),
                        label: Text(
                          config.hasApiKey ? 'APIキー変更' : 'APIキー設定',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: () =>
                          _testAgentConnection(context, ref, config),
                      icon: const Icon(Icons.wifi_tethering, size: 18),
                      label: const Text('テスト'),
                    ),
                  ],
                ),
                if (config.hasApiKey) ...[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      onPressed: () =>
                          _confirmRemoveApiKey(context, ref, config),
                      icon: Icon(Icons.delete_outline,
                          size: 18, color: theme.colorScheme.error),
                      label: Text(
                        'APIキーを削除',
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Color _providerColor(AgentConfig config) {
    switch ((config.agentType ?? config.provider ?? '').toLowerCase()) {
      case 'claude':
      case 'anthropic':
        return Colors.deepPurple;
      case 'chatgpt':
      case 'openai':
        return Colors.green;
      case 'gemini':
      case 'google':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  void _showApiKeyDialog(
      BuildContext context, WidgetRef ref, AgentConfig config) {
    final controller = TextEditingController();
    var obscureText = true;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${config.name} - APIキー設定'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (config.hasApiKey && config.maskedApiKey != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    '現在のキー: ${config.maskedApiKey}',
                    style: TextStyle(
                      color: Colors.grey[600],
                      fontSize: 13,
                    ),
                  ),
                ),
              TextField(
                controller: controller,
                obscureText: obscureText,
                decoration: InputDecoration(
                  labelText: 'APIキー',
                  hintText: 'sk-...',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      obscureText ? Icons.visibility : Icons.visibility_off,
                    ),
                    onPressed: () {
                      setDialogState(() => obscureText = !obscureText);
                    },
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('キャンセル'),
            ),
            FilledButton(
              onPressed: () async {
                final apiKey = controller.text.trim();
                if (apiKey.isEmpty) return;
                Navigator.pop(context);
                try {
                  await ref
                      .read(agentConfigsProvider.notifier)
                      .setApiKey(config.id, apiKey);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('APIキーを保存しました'),
                        backgroundColor: Colors.green,
                      ),
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('保存に失敗しました: $e'),
                        backgroundColor: Colors.red,
                      ),
                    );
                  }
                }
              },
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _testAgentConnection(
      BuildContext context, WidgetRef ref, AgentConfig config) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('接続テスト中...')),
    );
    final success = await ref
        .read(agentConfigsProvider.notifier)
        .testConnection(config.id);
    if (context.mounted) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(success ? '接続成功' : '接続失敗'),
          backgroundColor: success ? Colors.green : Colors.red,
        ),
      );
    }
  }

  void _confirmRemoveApiKey(
      BuildContext context, WidgetRef ref, AgentConfig config) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('APIキーの削除'),
        content: Text('${config.name}のAPIキーを削除しますか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () async {
              Navigator.pop(context);
              try {
                await ref
                    .read(agentConfigsProvider.notifier)
                    .removeApiKey(config.id);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('APIキーを削除しました'),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('削除に失敗しました: $e'),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              }
            },
            child: const Text('削除'),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _InfoRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: TextStyle(
                color: Colors.grey[600],
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: valueColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;

  const _SectionTitle(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }
}
