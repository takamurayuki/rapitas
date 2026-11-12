import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/centered_message.dart';
import 'backlog_widgets.dart';
import '../../widgets/voice_mode_indicator.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// 懸念一覧（全状態の先頭100件）。追加ができる。
/// 削除は行の横スワイプ（右から左）＋確認ダイアログ。
class ConcernsScreen extends ConsumerStatefulWidget {
  const ConcernsScreen({super.key});

  @override
  ConsumerState<ConcernsScreen> createState() => _ConcernsScreenState();
}

class _ConcernsScreenState extends ConsumerState<ConcernsScreen> {
  /// 削除リクエスト中の懸念ID（二重実行防止）
  final Set<String> _deleting = {};

  /// スワイプで消えた行のID。再取得の結果が届くまで一覧から外しておく
  /// （Dismissible は消えた後も木に残るとエラーになるため）。
  final Set<String> _dismissed = {};

  /// スワイプ削除の確認→削除。削除できたら true（行が消える）、
  /// キャンセル・失敗・実行中なら false（行はスワイプ前に戻る）。
  Future<bool> _delete(Concern concern) async {
    if (_deleting.contains(concern.id)) return false;
    final ok = await confirmBacklogDelete(
      context,
      '「${concern.title}」を削除します。元に戻せません。',
    );
    if (!ok || !mounted) return false;

    setState(() => _deleting.add(concern.id));
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(backlogServiceProvider).deleteConcern(concern.id);
    } catch (e) {
      if (mounted) setState(() => _deleting.remove(concern.id));
      messenger.showSnackBar(SnackBar(content: Text('懸念の削除に失敗しました: $e')));
      return false;
    }
    container.invalidate(concernListProvider);
    if (mounted) setState(() => _deleting.remove(concern.id));
    messenger.showSnackBar(const SnackBar(content: Text('懸念を削除しました')));
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final concernsAsync = ref.watch(concernListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('懸念'),
        actions: [
          const VoiceModeIndicator(trailing: false),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: '懸念を追加',
            onPressed: () => context.push('/concerns/new'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: '/concerns',
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(concernListProvider);
            try {
              await ref.read(concernListProvider.future);
            } catch (_) {}
          },
          child: concernsAsync.when(
            data: (fetched) {
              final concerns = fetched.where((c) => !_dismissed.contains(c.id)).toList();
              if (concerns.isEmpty) {
                return const CenteredMessage(
                  icon: Icons.report_problem_outlined,
                  message: '懸念はありません',
                );
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 16),
                itemCount: concerns.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final concern = concerns[index];
                  return BacklogSwipeToDelete(
                    itemKey: ValueKey('concern-${concern.id}'),
                    deleting: _deleting.contains(concern.id),
                    onConfirmDelete: () => _delete(concern),
                    onDismissed: () => setState(() => _dismissed.add(concern.id)),
                    child: _ConcernTile(concern: concern),
                  );
                },
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
              icon: Icons.error_outline,
              iconColor: Colors.red,
              message: '懸念の取得に失敗しました',
              action: ElevatedButton(
                onPressed: () => ref.invalidate(concernListProvider),
                child: const Text('再試行'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 懸念行（タイトル＋種別・重要度チップ＋状態ラベル）。削除は行のスワイプで行う
class _ConcernTile extends StatelessWidget {
  final Concern concern;

  const _ConcernTile({required this.concern});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final typeLabel = concernTypeLabels[concern.type] ?? concern.type;
    final severityLabel = concernSeverityLabels[concern.severity];
    final statusLabel = concernStatusLabels[concern.status] ?? concern.status;
    // 未対応以外（タスク化済・却下・解決済み）は済んだものとして薄く見せる
    final settled = concern.status != 'open';
    return ListTile(
      title: Text(
        concern.title.isNotEmpty ? concern.title : '（無題）',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: settled
            ? TextStyle(color: theme.colorScheme.onSurfaceVariant)
            : null,
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            BacklogChip(label: typeLabel),
            if (severityLabel != null)
              BacklogChip(
                label: '重要度 $severityLabel',
                color: settled ? null : backlogPriorityColor(concern.severity),
              ),
            Text(statusLabel, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
