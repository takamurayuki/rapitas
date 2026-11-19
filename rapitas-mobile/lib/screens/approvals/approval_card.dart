import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/approval_request.dart';
import '../../providers/approval_provider.dart';
import '../../providers/service_providers.dart';
import '../../utils/date_formatter.dart';
import '../../widgets/status_badge.dart';

// 承認リクエスト1件のカード（承認／却下）。
// NOTE: approvals_screen.dart から動きを変えずに切り出した（質問 section を足すための分割）。

class ApprovalCard extends ConsumerWidget {
  final ApprovalRequest approval;

  const ApprovalCard({super.key, required this.approval});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
