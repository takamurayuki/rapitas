import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/agent_provider.dart';
import '../../providers/settings_provider.dart';
import 'agent_config_accordion.dart';
import 'connection_section.dart';
import 'voice_learning_tiles.dart';
import 'voice_mode_tile.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';

// NOTE: パスは AppRoutes.settings と同じ値（routes.dart との import の循環を避けて文字列で持つ）
const String _path = '/settings';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final agentConfigsAsync = ref.watch(agentConfigsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('設定'),
        actions: const [VoiceModeIndicator()],
      ),
      body: VoiceScrollTarget(
        path: _path,
        // 設定には引っ張って更新が無いので、「更新」ではAPIキー設定を読み直す（接続は「再接続」の対象で、ここでは触らない）
        onRefresh: () => ref.read(agentConfigsProvider.notifier).refresh(),
        child: ListView(
          // 最後の項目がホームインジケーターに掛からないよう、下端の安全領域＋余白を空ける
          padding: EdgeInsets.only(bottom: 16 + MediaQuery.paddingOf(context).bottom),
          children: [
            const _SectionTitle('デスクトップとの接続'),
            const ConnectionSection(),
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
                  : AgentConfigAccordion(configs: configs),
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
            const _SectionTitle('音声操作'),
            const VoiceModeTile(),
            VoiceLearningTiles(onOpenList: () => context.push(voiceLearningPath)),
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
              subtitle: Text('Rapitas Mobile'),
            ),
          ],
        ),
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
