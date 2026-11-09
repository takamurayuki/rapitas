import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/centered_message.dart';
import 'backlog_widgets.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// アイデア一覧（先頭100件）。追加・削除ができる。
class IdeasScreen extends ConsumerStatefulWidget {
  const IdeasScreen({super.key});

  @override
  ConsumerState<IdeasScreen> createState() => _IdeasScreenState();
}

class _IdeasScreenState extends ConsumerState<IdeasScreen> {
  /// 削除リクエスト中のアイデアID（二重タップ防止）
  final Set<String> _deleting = {};

  Future<void> _delete(Idea idea) async {
    if (_deleting.contains(idea.id)) return;
    final ok = await confirmBacklogDelete(
      context,
      '「${idea.title}」を削除します。元に戻せません。',
    );
    if (!ok || !mounted) return;

    setState(() => _deleting.add(idea.id));
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(backlogServiceProvider).deleteIdea(idea.id);
    } catch (e) {
      if (mounted) setState(() => _deleting.remove(idea.id));
      messenger.showSnackBar(SnackBar(content: Text('アイデアの削除に失敗しました: $e')));
      return;
    }
    container.invalidate(ideaListProvider);
    if (mounted) setState(() => _deleting.remove(idea.id));
    messenger.showSnackBar(const SnackBar(content: Text('アイデアを削除しました')));
  }

  @override
  Widget build(BuildContext context) {
    final ideasAsync = ref.watch(ideaListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('アイデア'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'アイデアを追加',
            onPressed: () => context.push('/ideas/new'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: '/ideas',
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(ideaListProvider);
            try {
              await ref.read(ideaListProvider.future);
            } catch (_) {}
          },
          child: ideasAsync.when(
            data: (ideas) {
              if (ideas.isEmpty) {
                return const CenteredMessage(
                  icon: Icons.lightbulb_outline,
                  message: 'アイデアはありません',
                );
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 16),
                itemCount: ideas.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final idea = ideas[index];
                  return _IdeaTile(
                    idea: idea,
                    deleting: _deleting.contains(idea.id),
                    onDelete: () => _delete(idea),
                  );
                },
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
              icon: Icons.error_outline,
              iconColor: Colors.red,
              message: 'アイデアの取得に失敗しました',
              action: ElevatedButton(
                onPressed: () => ref.invalidate(ideaListProvider),
                child: const Text('再試行'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// アイデア行（タイトル＋優先度チップ＋作成日＋削除）
class _IdeaTile extends StatelessWidget {
  final Idea idea;
  final bool deleting;
  final VoidCallback onDelete;

  const _IdeaTile({
    required this.idea,
    required this.deleting,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final priorityLabel = ideaPriorityLabels[idea.priority];
    final date = formatBacklogDate(idea.createdAt);
    return ListTile(
      title: Text(
        idea.title.isNotEmpty ? idea.title : '（無題）',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          children: [
            if (priorityLabel != null) ...[
              BacklogChip(
                label: '優先度 $priorityLabel',
                color: backlogPriorityColor(idea.priority),
              ),
              const SizedBox(width: 8),
            ],
            if (date.isNotEmpty) Text(date),
          ],
        ),
      ),
      trailing: deleting
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
          : IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: 'アイデアを削除',
              onPressed: onDelete,
            ),
    );
  }
}
