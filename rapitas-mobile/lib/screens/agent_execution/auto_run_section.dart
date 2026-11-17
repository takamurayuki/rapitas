import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../models/theme_auto_run.dart';
import '../../providers/execution_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_auto_run_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/theme_auto_run_service.dart';
import '../../widgets/color_dot.dart';
import 'auto_run_theme_list.dart';
import 'section_title.dart';

/// 実行画面上部の「自動実行」セクション。開発テーマごとに自動実行の状態と
/// 開始・一時停止・停止の操作を出す（GET/POST /themes/:id/auto-run）。
class AutoRunSection extends ConsumerWidget {
  const AutoRunSection({super.key});

  /// 引っ張って更新で読み直すもの（テーマ一覧と各テーマの自動実行状態）
  static void invalidate(ProviderContainer container) {
    container.invalidate(themeListProvider);
    container.invalidate(themeAutoRunProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themesAsync = ref.watch(developmentThemesProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionTitle('自動実行'),
        ...themesAsync.when(
          loading: () => const [
            Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          ],
          error: (_, __) => [
            AutoRunMessageCard(
              icon: Icons.error_outline,
              text: 'テーマを取得できませんでした',
              action: TextButton(
                onPressed: () => ref.invalidate(themeListProvider),
                child: const Text('再試行'),
              ),
            ),
          ],
          // NOTE: 絞り込み（実行画面上部のバー）と空の案内は auto_run_theme_list.dart
          data: (themes) => autoRunThemeList(ref, themes, (t) => _AutoRunThemeCard(theme: t)),
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}

/// 1テーマ分のカード。操作の失敗理由（400 の error など）はカード内に残す
class _AutoRunThemeCard extends ConsumerStatefulWidget {
  final TaskTheme theme;

  const _AutoRunThemeCard({required this.theme});

  @override
  ConsumerState<_AutoRunThemeCard> createState() => _AutoRunThemeCardState();
}

class _AutoRunThemeCardState extends ConsumerState<_AutoRunThemeCard> {
  String? _actionError;
  bool _busy = false;

  TaskTheme get _theme => widget.theme;

  // バックエンドは空文字の workingDirectory も未設定として 400 にする
  bool get _hasFolder => (_theme.workingDirectory ?? '').trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final snapshotAsync = ref.watch(themeAutoRunProvider(_theme.id));
    final snapshot = snapshotAsync.valueOrNull;
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;
    final running = snapshot?.state.isRunning ?? false;

    return Card(
      key: ValueKey('auto-run-theme-${_theme.id}'),
      color: running ? colorScheme.primaryContainer : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                ColorDot(color: _theme.color),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(_theme.name,
                      style: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                ),
                if (snapshot != null) _StatusLabel(state: snapshot.state),
              ],
            ),
            const SizedBox(height: 4),
            ...snapshotAsync.when(
              loading: () => const [LinearProgressIndicator(minHeight: 2)],
              error: (e, _) => [
                Row(children: [
                  Expanded(child: Text('自動実行の状態を取得できませんでした: $e', style: textTheme.bodySmall)),
                  TextButton(onPressed: () => ref.invalidate(themeAutoRunProvider(_theme.id)), child: const Text('再試行')),
                ]),
              ],
              data: (s) => _details(context, s),
            ),
            if (!_hasFolder)
              _Note(
                icon: Icons.folder_off_outlined,
                text: '作業フォルダが未設定のため開始できません。テーマの編集で作業フォルダを設定してください。',
                color: colorScheme.onSurfaceVariant,
              ),
            if (_actionError != null)
              _Note(
                key: const ValueKey('auto-run-action-error'),
                icon: Icons.error_outline,
                text: _actionError!,
                color: colorScheme.error,
              ),
            if (snapshot != null) _actions(snapshot.state),
          ],
        ),
      ),
    );
  }

  List<Widget> _details(BuildContext context, ThemeAutoRunSnapshot s) {
    final state = s.state;
    final bodySmall = Theme.of(context).textTheme.bodySmall;
    final lines = <Widget>[];
    if (state.isRunning) {
      lines.add(Text('自動実行中：${_theme.name}',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)));
    }
    final currentTitle = _currentTaskTitle(s);
    if (currentTitle != null && (state.isRunning || state.isPaused || state.isStopping)) {
      lines.add(Text('実行中のタスク：$currentTitle', maxLines: 2, overflow: TextOverflow.ellipsis));
    } else if (state.isRunning) {
      lines.add(Text('次のタスクを選んでいます', style: bodySmall));
    }
    final counts = ['処理済み ${state.processedCount}件', if (s.remainingCount != null) '残り ${s.remainingCount}件'];
    lines.add(Text('${counts.join('・')}・${state.order == 'created' ? '作成順' : '優先度順'}', style: bodySmall));
    final statusNote = _statusSentence(state);
    if (statusNote != null) lines.add(Text(statusNote, style: bodySmall));
    if (state.lastError != null) {
      lines.add(_Note(
        key: const ValueKey('auto-run-last-error'),
        icon: Icons.warning_amber_outlined,
        text: '直近のエラー：${state.lastError}',
        color: Theme.of(context).colorScheme.error,
      ));
    }
    return lines;
  }

  /// GET の currentTask を優先し、無ければ手元のタスク一覧、最後は「タスク #id」
  String? _currentTaskTitle(ThemeAutoRunSnapshot s) {
    if (s.currentTaskTitle != null) return s.currentTaskTitle;
    final id = s.state.currentTaskId;
    if (id == null) return null;
    return taskTitleOrFallback(ref.read(taskTitleLookupProvider), id);
  }

  /// 状態を言い換えず、返ってきた値（status / pauseReason）をそのまま文にする
  String? _statusSentence(ThemeAutoRunState state) {
    switch (state.status) {
      case 'paused':
        return switch (state.pauseReason) {
          'user' => '一時停止中です（手動で一時停止）。次のタスクは選ばれません。',
          'awaiting_approval' => '一時停止中です（計画の承認待ち）。承認されると続きます。',
          _ => '一時停止中です（理由: ${state.pauseReason ?? '不明'}）。',
        };
      case 'stopping':
        return '停止処理中です。実行中のエージェントを止めています。';
      case 'running':
      case 'idle':
        return null;
      default:
        return '状態: ${state.status}';
    }
  }

  Widget _actions(ThemeAutoRunState state) {
    final buttons = <Widget>[];
    if (state.isRunning) {
      buttons.add(TextButton.icon(
        icon: const Icon(Icons.pause),
        label: const Text('一時停止'),
        onPressed: _busy ? null : () => _run(() => _service.pause(_theme.id), '一時停止しました（実行中のタスクは最後まで続きます）'),
      ));
    }
    if (state.isRunning || state.isPaused) {
      buttons.add(TextButton.icon(
        key: ValueKey('auto-run-stop-${_theme.id}'),
        style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
        icon: const Icon(Icons.stop),
        label: const Text('停止'),
        onPressed: _busy ? null : _stop,
      ));
    }
    if (state.isIdle) {
      buttons.add(FilledButton.icon(
        key: ValueKey('auto-run-start-${_theme.id}'),
        icon: const Icon(Icons.play_arrow),
        label: const Text('自動実行を開始'),
        onPressed: _busy || !_hasFolder ? null : _start,
      ));
    } else if (state.isPaused) {
      buttons.add(FilledButton.tonalIcon(
        key: ValueKey('auto-run-resume-${_theme.id}'),
        icon: const Icon(Icons.play_arrow),
        label: const Text('再開'),
        onPressed: _busy ? null : () => _run(() => _service.start(_theme.id, order: state.order), '自動実行を再開しました'),
      ));
    }
    if (buttons.isEmpty) return const SizedBox(height: 4);
    return Container(
      width: double.infinity, // NOTE: 全幅でないと開始系が右に寄らない
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(alignment: WrapAlignment.end, spacing: 8, children: buttons),
    );
  }

  ThemeAutoRunService get _service => ref.read(themeAutoRunServiceProvider);

  Future<void> _start() async {
    final order = await showDialog<String>(
      context: context,
      builder: (_) => _StartDialog(themeName: _theme.name),
    );
    if (order == null || !mounted) return;
    await _run(() => _service.start(_theme.id, order: order), '「${_theme.name}」の自動実行を開始しました');
  }

  Future<void> _stop() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('自動実行を停止'),
        content: Text('「${_theme.name}」の自動実行を停止しますか？\n'
            'このテーマで実行中のエージェントも止まり、コミットしていない実装は失われます。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('いいえ')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('停止')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _run(() => _service.stop(_theme.id), '「${_theme.name}」の自動実行を停止しました');
  }

  /// 操作して読み直す。await 中に破棄されても読み直せるよう container を先に控える
  Future<void> _run(Future<void> Function() action, String successText) async {
    final container = ProviderScope.containerOf(context, listen: false);
    final messenger = ScaffoldMessenger.maybeOf(context);
    setState(() {
      _busy = true;
      _actionError = null;
    });
    String? error;
    try {
      await action();
    } catch (e) {
      error = e.toString();
    }
    container.invalidate(themeAutoRunProvider(_theme.id));
    container.invalidate(executingTasksProvider);
    container.invalidate(taskListProvider);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _actionError = error;
    });
    if (error == null) messenger?.showSnackBar(SnackBar(content: Text(successText)));
  }
}

class _StatusLabel extends StatelessWidget {
  final ThemeAutoRunState state;

  const _StatusLabel({required this.state});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final (text, color) = switch (state.status) {
      'running' => ('自動実行中', colorScheme.primary),
      'paused' => ('一時停止中', Colors.amber.shade800),
      'stopping' => ('停止処理中', colorScheme.error),
      'idle' => ('停止中', colorScheme.onSurfaceVariant),
      _ => (state.status, colorScheme.onSurfaceVariant),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color)),
    );
  }
}

class _Note extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _Note({super.key, required this.icon, required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color))),
        ],
      ),
    );
  }
}

/// 開始の確認。並び順（API の order）を選んで返す。キャンセルは null
class _StartDialog extends StatefulWidget {
  final String themeName;

  const _StartDialog({required this.themeName});

  @override
  State<_StartDialog> createState() => _StartDialogState();
}

class _StartDialogState extends State<_StartDialog> {
  String _order = 'priority';

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('自動実行を開始'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('「${widget.themeName}」の未完了タスクを、AIエージェントで1件ずつ順に自動実行します。'),
          const SizedBox(height: 16),
          const Text('実行する順番'),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'priority', label: Text('優先度順')),
              ButtonSegment(value: 'created', label: Text('作成順')),
            ],
            selected: {_order},
            onSelectionChanged: (s) => setState(() => _order = s.first),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('キャンセル')),
        FilledButton(onPressed: () => Navigator.pop(context, _order), child: const Text('開始')),
      ],
    );
  }
}
