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

  /// 選んだテーマID または ideaNoThemeId（明示的な「指定なし」）。
  /// null は「まだ初期値が決まっていない」（テーマ一覧・記憶の解決待ち）で、「指定なし」とは区別する
  String? _themeChoice;

  /// テーマ初期値の解決。決まる前に「追加」を押されたら、保存はこれを待ってから送る
  late final Future<String> _themeResolution;

  /// 声で開いたか（タイトル欄に自動でフォーカスしない）
  bool _openedByVoice = false;

  @override
  void initState() {
    super.initState();
    // 声で開いたときは入力欄にフォーカスしない（常時聞き取りを止めないため。VoiceOpenedScreens）
    _openedByVoice = VoiceOpenedScreens.consume(_newPath);
    _themeResolution = _resolveInitialTheme();
    _themeResolution.then((choice) {
      if (mounted && _themeChoice == null) setState(() => _themeChoice = choice);
    });
  }

  /// テーマの初期値を決める：一覧で選んでいるテーマ → 初期選択の解決（記憶 → ☆ → 先頭）→ 指定なし。
  ///
  /// テーマ一覧の取得失敗・正常0件はテーマ欄を出せないので「指定なし」（themeId を送らない）に確定する。
  Future<String> _resolveInitialTheme() async {
    final List<TaskTheme> themes;
    try {
      themes = await ref.read(themeListProvider.future);
    } catch (_) {
      return ideaNoThemeId;
    }
    if (themes.isEmpty) return ideaNoThemeId;
    String? initial;
    try {
      initial = await ref.read(ideaInitialSelectionProvider.future);
    } catch (_) {
      initial = null;
    }
    // NOTE: 一覧の選択は解決を待った後に読む（待っている間に一覧側で選ばれた値も拾う）
    for (final candidate in [ref.read(ideaFilterProvider).themeId, initial]) {
      if (candidate == ideaNoThemeId) return ideaNoThemeId;
      if (candidate != null && themes.any((t) => t.id == candidate)) return candidate;
    }
    return ideaNoThemeId;
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
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    // NOTE: 初期値が未解決のうちに押されたら解決を待つ。null を「指定なし」として送ると、
    // 記憶や ☆ があってもテーマなし（scope: global）で作られてしまうため
    final themeChoice = _themeChoice ?? await _themeResolution;
    if (!mounted) return;
    final themes = ref.read(themeListProvider).valueOrNull;
    final validTheme = themeChoice != ideaNoThemeId && (themes?.any((t) => t.id == themeChoice) ?? false);
    final body = buildIdeaCreateBody(
      title: _titleController.text,
      content: _contentController.text,
      priority: _priority,
      themeId: validTheme ? themeChoice : null,
    );

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

  /// テーマ欄。テーマが0件なら出さない（タスク作成フォームのテーマ欄と同じ方針）。
  /// 取得に失敗したときは「指定なし」で作ることを一言添える。初期値が決まるまでは進捗バー
  Widget _themeField() {
    final themesAsync = ref.watch(themeListProvider);
    final themes = themesAsync.valueOrNull;
    if (themes == null && themesAsync.hasError) {
      return const InputDecorator(
        decoration: InputDecoration(
          labelText: 'テーマ',
          prefixIcon: Icon(Icons.folder),
          enabled: false,
          helperText: 'テーマ一覧を取得できないため、テーマは「指定なし」で追加します',
          helperMaxLines: 2,
        ),
        child: Text('指定なし'),
      );
    }
    if (themes != null && themes.isEmpty) return const SizedBox.shrink();
    final choice = _themeChoice;
    if (themes == null || choice == null) return const LinearProgressIndicator();
    final value = themes.any((t) => t.id == choice) ? choice : ideaNoThemeId;
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
