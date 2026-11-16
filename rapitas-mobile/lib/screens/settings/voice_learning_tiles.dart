/// VoiceLearningTiles
///
/// The "聞き間違いの学習" switch and the entry to the learned-corrections list,
/// shown under the voice mode switch in Settings (learning-design §5.1).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/voice_learning_provider.dart';

/// 学習した読み替えの一覧のパス（routes.dart の AppRoutes.voiceLearning と同じ値。import の循環を避けて文字列で持つ）
const String voiceLearningPath = '/settings/voice-learning';

/// 設定の「音声操作」セクションに足す、学習のスイッチと一覧への入口。
/// 音声操作モードとは独立して触れる（シートからの操作でも学習は働くため）
class VoiceLearningTiles extends ConsumerWidget {
  const VoiceLearningTiles({super.key, required this.onOpenList});

  /// 一覧画面を開く（アプリでは GoRouter の push）
  final VoidCallback onOpenList;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(voiceLearningEnabledProvider);
    final count = ref.watch(voiceLearningProvider).length;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SwitchListTile(
          key: const ValueKey('voice-learning-switch'),
          secondary: const Icon(Icons.spellcheck),
          title: const Text('聞き間違いの学習'),
          subtitle: Text(
            enabled
                ? 'オン：候補から選び直した対象を、この端末だけに覚えます'
                : count > 0
                    ? 'オフ：覚えた読み替えを使わず、新しく覚えもしません（保存済みの$count件は残っています）'
                    : 'オフ：覚えた読み替えを使わず、新しく覚えもしません',
          ),
          value: enabled,
          onChanged: (on) => ref.read(voiceLearningEnabledProvider.notifier).setEnabled(on),
        ),
        ListTile(
          key: const ValueKey('voice-learning-list-entry'),
          leading: const Icon(Icons.list),
          title: const Text('学習した読み替え'),
          subtitle: Text(count > 0 ? '$count件' : 'まだありません'),
          trailing: count > 0 ? const Icon(Icons.chevron_right) : null,
          enabled: count > 0,
          onTap: count > 0 ? onOpenList : null,
        ),
      ],
    );
  }
}
