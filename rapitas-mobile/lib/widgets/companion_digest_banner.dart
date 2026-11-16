import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../config/routes.dart';
import '../providers/companion_provider.dart';

/// ホームの「ラピから」の案内（ラピ伴走化 第2段階-1。アプリを開いたときに出す）。
///
/// 件数だけを出し、押すとラピタブで要約を見せる。ここで見ても既読にはしない
/// （何が起きたか・決めることは、ラピの要約で読んでもらう）
class CompanionDigestBanner extends ConsumerWidget {
  const CompanionDigestBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final digest = ref.watch(companionDigestProvider).digest;
    if (digest == null || digest.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final waiting = digest.decisionCount;
    final text = waiting > 0
        ? 'あなたの判断を待っているタスクが$waiting件あります'
        : '伴走中のタスクに新しい動きが${digest.items.length}件あります';
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Material(
        color: waiting > 0 ? scheme.tertiaryContainer : scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          key: const ValueKey('home-digest-banner'),
          borderRadius: BorderRadius.circular(12),
          onTap: () => context.go(AppRoutes.rapi),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('ラピから',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: waiting > 0
                                  ? scheme.onTertiaryContainer
                                  : scheme.onSecondaryContainer)),
                      const SizedBox(height: 2),
                      Text(text,
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: waiting > 0
                                  ? scheme.onTertiaryContainer
                                  : scheme.onSecondaryContainer)),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
