import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../models/task.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/backlog_service.dart';
import '../../services/filter_selection.dart';
import '../../services/voice_opened_screens.dart';
import '../../widgets/color_dot.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';

// NOTE: パスは config/routes.dart の AppRoutes と同じ値。routes.dart → この画面 という import の循環を作らないよう文字列で持つ。
const String _newPath = '/ideas/new';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// アイデアの追加フォーム（/ideas/new）。
///
/// テーマは全テーマ＋「指定なし」から選ぶ。初期値はアイデア一覧の現在の選択（記憶 → ☆ → 先頭。
/// 「指定なし」を選んでいれば指定なし）。テーマを選んだときだけ themeId を送る（buildIdeaCreateBody）。
class IdeaFormScreen extends ConsumerStatefulWidget {
  const IdeaFormScreen({super.key});

  @override
  ConsumerState<IdeaFormScreen> createState() => _IdeaFormScreenState();
}

class _IdeaFormScreenState extends ConsumerState<IdeaFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  String _priority = 'medium';
  bool _saving = false;

  /// 選んだテーマID または ideaNoThemeId。null はまだ初期値を決めていない（テーマ一覧の取得待ち）
  String? _themeChoice;

  /// 声で開いたか（タイトル欄に自動でフォーカスしない）
  bool _openedByVoice = false;

  @override
  void initState() {
    super.initState();
    // 声で開いたときは入力欄にフォーカスしない（常時聞き取りを止めないため。VoiceOpenedScreens）
    _openedByVoice = VoiceOpenedScreens.consume(_newPath);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final themeChoice = _themeChoice;
    final body = buildIdeaCreateBody(
      title: _titleController.text,
      content: _contentController.text,
      priority: _priority,
      themeId: themeChoice == null || themeChoice == ideaNoThemeId ? null : themeChoice,
    );
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);

    try {
      await ref.read(backlogServiceProvider).createIdea(body);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text('アイデアの保存に失敗しました: $e')));
      return;
    }

    container.invalidate(ideaListProvider);
    if (!mounted) return;
    messenger.showSnackBar(const SnackBar(content: Text('アイデアを追加しました')));
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/ideas');
    }
  }

  /// テーマ欄。テーマが無い・取れないときは出さない（タスク作成フォームのテーマ欄と同じ方針）
  Widget _themeField() {
    final themesAsync = ref.watch(themeListProvider);
    final themes = themesAsync.valueOrNull;
    if (themes == null || themes.isEmpty) {
      return themesAsync.isLoading ? const LinearProgressIndicator() : const SizedBox.shrink();
    }
    final initial = ref.watch(ideaInitialSelectionProvider);
    if (_themeChoice == null) {
      // 一覧で選んでいるテーマ → 初期選択の解決（記憶 → ☆ → 先頭）の順で初期値にする
      final current = ref.watch(ideaFilterProvider).themeId ?? initial.valueOrNull;
      if (current == null && initial.isLoading) return const LinearProgressIndicator();
      _themeChoice = current ?? ideaNoThemeId;
    }
    final value = themes.any((t) => t.id == _themeChoice) ? _themeChoice! : ideaNoThemeId;
    return _IdeaThemeDropdown(
      themes: themes,
      value: value,
      onChanged: _saving ? null : (v) => setState(() => _themeChoice = v),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新しいアイデア'), actions: const [VoiceModeIndicator()]),
      body: VoiceScrollTarget(
        path: _newPath,
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'タイトル',
                  hintText: 'アイデアを一言で',
                ),
                autofocus: !_openedByVoice,
                textInputAction: TextInputAction.next,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                validator: (value) => (value ?? '').trim().isEmpty
                    ? 'タイトルを入力してください'
                    : null,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _contentController,
                decoration: const InputDecoration(
                  labelText: '内容（任意）',
                  hintText: '詳しい説明。空ならタイトルが内容になります',
                  alignLabelWithHint: true,
                ),
                minLines: 4,
                maxLines: 10,
              ),
              const SizedBox(height: 16),
              InputDecorator(
                decoration: const InputDecoration(
                  labelText: '優先度',
                  prefixIcon: Icon(Icons.flag_outlined),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _priority,
                    isExpanded: true,
                    isDense: true,
                    items: [
                      for (final value in backlogPriorityOrder)
                        DropdownMenuItem<String>(
                          value: value,
                          child: Text(ideaPriorityLabels[value] ?? value),
                        ),
                    ],
                    onChanged: _saving
                        ? null
                        : (value) {
                            if (value != null) setState(() => _priority = value);
                          },
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _themeField(),
              const SizedBox(height: 32),
              FilledButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('追加'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// アイデアのテーマ選択（「指定なし」＋カテゴリ順のテーマ。テーマ名の右にカテゴリ名を薄く出す）
class _IdeaThemeDropdown extends StatelessWidget {
  final List<TaskTheme> themes;
  final String value;
  final ValueChanged<String>? onChanged;

  const _IdeaThemeDropdown({required this.themes, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        );
    return InputDecorator(
      decoration: const InputDecoration(
        labelText: 'テーマ',
        prefixIcon: Icon(Icons.folder),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          isDense: true,
          items: [
            const DropdownMenuItem<String>(value: ideaNoThemeId, child: Text('指定なし')),
            for (final group in groupThemesByCategory(themes))
              for (final theme in group.themes)
                DropdownMenuItem<String>(
                  value: theme.id,
                  child: Row(
                    children: [
                      ColorDot(color: theme.color),
                      const SizedBox(width: 8),
                      Flexible(child: Text(theme.name, overflow: TextOverflow.ellipsis)),
                      if (group.category?.name case final name? when name.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Text(name, style: muted, overflow: TextOverflow.ellipsis),
                      ],
                    ],
                  ),
                ),
          ],
          onChanged: onChanged == null
              ? null
              : (v) {
                  if (v != null) onChanged!(v);
                },
        ),
      ),
    );
  }
}
