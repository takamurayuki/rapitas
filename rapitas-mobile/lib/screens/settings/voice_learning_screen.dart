/// VoiceLearningScreen
///
/// Lists the learned voice corrections (newest first) with per-row delete +
/// undo and a confirmed "delete all" (learning-design §5.2).
/// Deleting learning data by voice is intentionally not offered: a misheard
/// command must never wipe it.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/voice_learning_provider.dart';
import '../../services/voice_learning_store.dart';
import '../../utils/date_formatter.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';
import 'voice_learning_tiles.dart' show voiceLearningPath;

/// 種別の表示名（一覧のサブタイトル）
const Map<VoiceTargetKind, String> voiceTargetKindLabels = {
  VoiceTargetKind.task: 'タスク',
  VoiceTargetKind.approval: '承認',
  VoiceTargetKind.hypothesis: '仮説',
  VoiceTargetKind.idea: 'アイデア',
  VoiceTargetKind.concern: '懸念',
  VoiceTargetKind.executingTask: '実行中のタスク',
  VoiceTargetKind.resumable: '再開できる実行',
  VoiceTargetKind.theme: 'テーマ',
};

class VoiceLearningScreen extends ConsumerWidget {
  const VoiceLearningScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(voiceLearningProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('学習した読み替え'),
        actions: [
          const VoiceModeIndicator(),
          TextButton(
            key: const ValueKey('voice-learning-clear-all'),
            onPressed: items.isEmpty ? null : () => _confirmClear(context, ref, items.length),
            child: const Text('すべて消去'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: voiceLearningPath,
        child: items.isEmpty
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('覚えた読み替えはありません', style: TextStyle(color: Colors.grey)),
                ),
              )
            : ListView.builder(
                padding: EdgeInsets.only(bottom: 16 + MediaQuery.paddingOf(context).bottom),
                itemCount: items.length,
                itemBuilder: (context, i) => _CorrectionRow(correction: items[i]),
              ),
      ),
    );
  }

  Future<void> _confirmClear(BuildContext context, WidgetRef ref, int count) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('すべて消去'),
        content: Text('覚えた読み替え$count件をすべて消します。元に戻せません。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('キャンセル')),
          TextButton(
            key: const ValueKey('voice-learning-clear-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('消去'),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(voiceLearningProvider.notifier).clear();
  }
}

class _CorrectionRow extends ConsumerWidget {
  const _CorrectionRow({required this.correction});

  final VoiceCorrection correction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = correction;
    return ListTile(
      key: ValueKey('voice-learning-row-${c.kind.name}-${c.heard}'),
      title: Text('「${c.heardText}」→ ${c.label}'),
      subtitle: Text(
        '${voiceTargetKindLabels[c.kind]}・${c.count}回・最終 ${DateFormatter.formatDate(c.lastUsedAt)}',
      ),
      trailing: IconButton(
        tooltip: '削除',
        icon: const Icon(Icons.delete_outline),
        // 1件だけなので確認ダイアログは挟まず、スナックバーの「元に戻す」で戻せるようにする
        onPressed: () async {
          final notifier = ref.read(voiceLearningProvider.notifier);
          final messenger = ScaffoldMessenger.maybeOf(context);
          await notifier.remove(c);
          messenger
            ?..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(
              content: Text('「${c.heardText}」の読み替えを消しました'),
              action: SnackBarAction(label: '元に戻す', onPressed: () => notifier.restore(c)),
            ));
        },
      ),
    );
  }
}
