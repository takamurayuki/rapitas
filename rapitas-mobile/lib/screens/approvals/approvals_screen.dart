import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/approval_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/voice_command_parser.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/voice_input_sheet.dart';
import '../../utils/date_formatter.dart';

class ApprovalsScreen extends ConsumerWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final approvalsAsync = ref.watch(approvalListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('承認リクエスト'),
        actions: [
          IconButton(
            icon: const Icon(Icons.mic),
            tooltip: '音声で承認・却下',
            onPressed: () => _handleVoiceApproval(context, ref),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(approvalListProvider),
        child: approvalsAsync.when(
          data: (approvals) {
            if (approvals.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.approval, size: 64, color: Colors.grey),
                    SizedBox(height: 16),
                    Text('承認リクエストはありません'),
                  ],
                ),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(8),
              itemCount: approvals.length,
              itemBuilder: (context, index) {
                final approval = approvals[index];
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                approval.title,
                                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                            ),
                            StatusBadge.approval(status: approval.status),
                          ],
                        ),
                        if (approval.description != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            approval.description!,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                        if (approval.requestType != null) ...[
                          const SizedBox(height: 4),
                          Chip(
                            label: Text(approval.requestType!, style: const TextStyle(fontSize: 11)),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                        const SizedBox(height: 8),
                        Text(
                          DateFormatter.formatRelative(approval.createdAt),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
                              ),
                        ),
                        if (approval.isPending) ...[
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              OutlinedButton(
                                onPressed: () => _rejectApproval(context, ref, approval.id),
                                style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                                child: const Text('却下'),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                onPressed: () => _approveApproval(context, ref, approval.id),
                                child: const Text('承認'),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('承認リクエストの取得に失敗しました'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => ref.invalidate(approvalListProvider),
                  child: const Text('再試行'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _handleVoiceApproval(BuildContext context, WidgetRef ref) async {
    final approvalsAsync = ref.read(approvalListProvider);
    final approvals = approvalsAsync.valueOrNull;
    final pendingApprovals = approvals?.where((a) => a.isPending).toList();

    if (pendingApprovals == null || pendingApprovals.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('保留中の承認リクエストはありません')),
      );
      return;
    }

    final command = await VoiceInputSheet.show(
      context,
      expectedType: VoiceCommandType.approveRequest,
      hint: '「承認」または「却下」と話してください',
    );

    if (command == null || !context.mounted) return;

    // 最新の保留中リクエストに対して操作
    final target = pendingApprovals.first;

    if (command.type == VoiceCommandType.approveRequest) {
      await _approveApproval(context, ref, target.id);
    } else if (command.type == VoiceCommandType.rejectRequest) {
      try {
        await ref.read(approvalServiceProvider).reject(
              target.id,
              reason: command.reason,
            );
        ref.invalidate(approvalListProvider);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('却下しました')),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('却下に失敗しました: $e')),
          );
        }
      }
    }
  }

  Future<void> _approveApproval(BuildContext context, WidgetRef ref, String id) async {
    try {
      await ref.read(approvalServiceProvider).approve(id);
      ref.invalidate(approvalListProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('承認しました')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('承認に失敗しました: $e')),
        );
      }
    }
  }

  Future<void> _rejectApproval(BuildContext context, WidgetRef ref, String id) async {
    final reasonController = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('却下理由'),
        content: TextField(
          controller: reasonController,
          decoration: const InputDecoration(
            labelText: '理由（任意）',
            hintText: '却下する理由を入力',
          ),
          maxLines: 3,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('キャンセル')),
          FilledButton(
            onPressed: () => Navigator.pop(context, reasonController.text),
            child: const Text('却下'),
          ),
        ],
      ),
    );

    if (reason != null) {
      try {
        await ref.read(approvalServiceProvider).reject(id, reason: reason.isEmpty ? null : reason);
        ref.invalidate(approvalListProvider);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('却下しました')),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('却下に失敗しました: $e')),
          );
        }
      }
    }
  }
}
