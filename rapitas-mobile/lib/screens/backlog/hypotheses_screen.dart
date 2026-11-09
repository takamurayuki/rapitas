import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/backlog.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/centered_message.dart';
import 'backlog_widgets.dart';
import '../../widgets/voice_mode_indicator.dart';

/// 状態ごとのチップの色
Color? _statusColor(String status) {
  switch (status) {
    case 'open':
      return Colors.indigo;
    case 'supported':
      return Colors.green;
    case 'refuted':
      return Colors.red;
    case 'inconclusive':
      return Colors.amber.shade800;
    default:
      return null;
  }
}

/// 行末メニューの操作。status が null なら削除。
class _MenuAction {
  final String? status;

  const _MenuAction.setStatus(String this.status);
  const _MenuAction.delete() : status = null;
}

/// 仮説一覧（全状態の先頭100件）。仮説はエージェントが起票するので作成は無い。
/// 行末メニューから状態の手動変更と削除ができる。
class HypothesesScreen extends ConsumerStatefulWidget {
  const HypothesesScreen({super.key});

  @override
  ConsumerState<HypothesesScreen> createState() => _HypothesesScreenState();
}

class _HypothesesScreenState extends ConsumerState<HypothesesScreen> {
  /// 変更・削除リクエスト中の仮説ID（二重操作防止）
  final Set<String> _busy = {};

  Future<void> _run(
    Hypothesis hypothesis,
    Future<void> Function() request, {
    required String success,
    required String failure,
  }) async {
    setState(() => _busy.add(hypothesis.id));
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await request();
    } catch (e) {
      if (mounted) setState(() => _busy.remove(hypothesis.id));
      messenger.showSnackBar(SnackBar(content: Text('$failure: $e')));
      return;
    }
    container.invalidate(hypothesisListProvider);
    if (mounted) setState(() => _busy.remove(hypothesis.id));
    messenger.showSnackBar(SnackBar(content: Text(success)));
  }

  Future<void> _onMenu(Hypothesis hypothesis, _MenuAction action) async {
    if (_busy.contains(hypothesis.id)) return;
    final service = ref.read(backlogServiceProvider);
    final status = action.status;

    if (status != null) {
      final label = hypothesisStatusLabels[status] ?? status;
      await _run(
        hypothesis,
        () => service.updateHypothesisStatus(hypothesis.id, status),
        success: '状態を「$label」にしました',
        failure: '状態の変更に失敗しました',
      );
      return;
    }

    final ok = await confirmBacklogDelete(context, 'この仮説を削除します。元に戻せません。');
    if (!ok || !mounted) return;
    await _run(
      hypothesis,
      () => service.deleteHypothesis(hypothesis.id),
      success: '仮説を削除しました',
      failure: '仮説の削除に失敗しました',
    );
  }

  @override
  Widget build(BuildContext context) {
    final hypothesesAsync = ref.watch(hypothesisListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('仮説'), actions: const [VoiceModeIndicator()]),
      body: VoiceScrollTarget(
        path: '/hypotheses',
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(hypothesisListProvider);
            try {
              await ref.read(hypothesisListProvider.future);
            } catch (_) {}
          },
          child: hypothesesAsync.when(
            data: (hypotheses) {
              if (hypotheses.isEmpty) {
                return const CenteredMessage(
                  icon: Icons.science_outlined,
                  message: '仮説はありません\nエージェントが調査・検証の中で記録します',
                );
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 16),
                itemCount: hypotheses.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final hypothesis = hypotheses[index];
                  return _HypothesisTile(
                    hypothesis: hypothesis,
                    busy: _busy.contains(hypothesis.id),
                    onSelected: (action) => _onMenu(hypothesis, action),
                  );
                },
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
              icon: Icons.error_outline,
              iconColor: Colors.red,
              message: '仮説の取得に失敗しました',
              action: ElevatedButton(
                onPressed: () => ref.invalidate(hypothesisListProvider),
                child: const Text('再試行'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 仮説行（命題＋状態チップ＋確信度＋行末メニュー）
class _HypothesisTile extends StatelessWidget {
  final Hypothesis hypothesis;
  final bool busy;
  final ValueChanged<_MenuAction> onSelected;

  const _HypothesisTile({
    required this.hypothesis,
    required this.busy,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = hypothesis.status;
    final statusLabel = hypothesisStatusLabels[status] ?? status;
    return ListTile(
      title: Text(
        hypothesis.statement.isNotEmpty ? hypothesis.statement : '（命題なし）',
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            BacklogChip(label: statusLabel, color: _statusColor(status)),
            Text(
              '確信度 ${hypothesis.confidencePercent}%',
              style: theme.textTheme.bodySmall,
            ),
            if (hypothesis.domain.isNotEmpty)
              Text(hypothesis.domain, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
      trailing: busy
          ? const SizedBox(
              width: 48,
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          : PopupMenuButton<_MenuAction>(
              tooltip: '操作',
              icon: const Icon(Icons.more_vert),
              onSelected: onSelected,
              itemBuilder: (context) => [
                for (final entry in hypothesisStatusLabels.entries)
                  if (entry.key != status)
                    PopupMenuItem<_MenuAction>(
                      value: _MenuAction.setStatus(entry.key),
                      child: Text('「${entry.value}」にする'),
                    ),
                const PopupMenuDivider(),
                PopupMenuItem<_MenuAction>(
                  value: const _MenuAction.delete(),
                  child: Text(
                    '削除',
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              ],
            ),
    );
  }
}
