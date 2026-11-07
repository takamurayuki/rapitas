import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/task_provider.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ダッシュボード'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(taskListProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _StatCard(
              title: '今日のサマリー',
              icon: Icons.today,
              child: Consumer(
                builder: (context, ref, _) {
                  final allTasks = ref.watch(taskListProvider(const TaskFilter()));
                  return allTasks.when(
                    data: (tasks) {
                      final todo = tasks.where((t) => t.status == 'todo').length;
                      final inProgress = tasks.where((t) => t.status == 'in-progress').length;
                      final done = tasks.where((t) => t.status == 'done').length;
                      return Column(
                        children: [
                          _StatRow(label: '未着手', value: '$todo', color: Colors.grey),
                          _StatRow(label: '進行中', value: '$inProgress', color: Colors.blue),
                          _StatRow(label: '完了', value: '$done', color: Colors.green),
                          const Divider(),
                          _StatRow(label: '合計', value: '${tasks.length}', color: Colors.black87),
                        ],
                      );
                    },
                    loading: () => const Center(child: CircularProgressIndicator()),
                    error: (_, __) => const Text('データの取得に失敗しました'),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget child;

  const _StatCard({required this.title, required this.icon, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text(title, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 16),
            child,
          ],
        ),
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _StatRow({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(width: 8),
              Text(label),
            ],
          ),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        ],
      ),
    );
  }
}
