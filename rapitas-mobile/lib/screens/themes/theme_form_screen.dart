import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/task.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../widgets/color_dot.dart';
import '../../widgets/color_swatch_picker.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// テーマのデフォルト色（バックエンドの Theme.color の既定値）
const String defaultThemeColor = '#8B5CF6';

/// テーマ作成・更新 API に送るボディを作る。
///
/// バックエンド（Elysia の t.Optional）は null を受け付けないため、値の無い項目はキーごと省く
/// （null を送ってよいのは編集時の categoryId だけだが、未分類へ戻す操作は無いので送らない）。
/// 編集時に説明・作業フォルダを空にした場合だけは、消したことを伝えるため空文字を送る。
///
/// @param name - テーマ名 / 前後の空白は落とす
/// @param color - 色（'#RRGGBB'）/ null ならキーを省く
/// @param categoryId - カテゴリID / int にして送る。変換できなければキーを省く
/// @param isDevelopment - 開発テーマか / 常に送る
/// @param workingDirectory - 作業フォルダ / 空なら作成時は省略、編集時は空文字
/// @param description - 説明 / 空なら作成時は省略、編集時は空文字
/// @param isEdit - 編集（PATCH）用のボディか
/// @returns リクエストボディ / null を含まない Map
Map<String, dynamic> buildThemeFormBody({
  required String name,
  String? color,
  String? categoryId,
  required bool isDevelopment,
  String? workingDirectory,
  String? description,
  bool isEdit = false,
}) {
  final parsedCategoryId = int.tryParse(categoryId?.trim() ?? '');
  final trimmedDirectory = workingDirectory?.trim() ?? '';
  final trimmedDescription = description?.trim() ?? '';
  return {
    'name': name.trim(),
    if (color != null) 'color': color,
    if (parsedCategoryId != null) 'categoryId': parsedCategoryId,
    'isDevelopment': isDevelopment,
    if (trimmedDirectory.isNotEmpty)
      'workingDirectory': trimmedDirectory
    else if (isEdit)
      'workingDirectory': '',
    if (trimmedDescription.isNotEmpty)
      'description': trimmedDescription
    else if (isEdit)
      'description': '',
  };
}

/// テーマ一覧から、テーマに埋め込まれたカテゴリを sortOrder 順に重複なく取り出す
/// （GET /categories が取れないときのカテゴリ選択肢の代替）
List<TaskCategory> categoriesFromThemes(List<TaskTheme> themes) {
  return [
    for (final group in groupThemesByCategory(themes))
      if (group.category != null) group.category!,
  ];
}

/// テーマの作成・編集フォーム。themeId も theme も無ければ作成、どちらかがあれば編集。
class ThemeFormScreen extends ConsumerStatefulWidget {
  /// 編集対象のテーマID（`/themes/:id/edit`）
  final String? themeId;

  /// 編集対象のテーマ（go_router の extra）。無ければ themeListProvider から探す
  final TaskTheme? theme;

  const ThemeFormScreen({super.key, this.themeId, this.theme});

  @override
  ConsumerState<ThemeFormScreen> createState() => _ThemeFormScreenState();
}

class _ThemeFormScreenState extends ConsumerState<ThemeFormScreen> {
  /// 見つからず閉じる処理を予約済みか（再ビルドで二重に pop しないため）
  bool _closing = false;

  void _closeNotFound() {
    if (_closing) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('テーマが見つかりませんでした')),
      );
      if (context.canPop()) {
        context.pop();
      } else {
        context.go('/themes');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final initial = widget.theme;
    final id = widget.themeId;
    if (initial != null || id == null) {
      return _ThemeForm(theme: initial);
    }

    final themesAsync = ref.watch(themeListProvider);
    return themesAsync.when(
      data: (themes) {
        for (final t in themes) {
          if (t.id == id) return _ThemeForm(theme: t);
        }
        // 見つからない（削除済み等）：画面を閉じる
        _closeNotFound();
        return const _PlaceholderScaffold(child: SizedBox.shrink());
      },
      loading: () => const _PlaceholderScaffold(
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => _PlaceholderScaffold(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 64, color: Colors.red),
              const SizedBox(height: 16),
              const Text('テーマの取得に失敗しました'),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: () => ref.invalidate(themeListProvider),
                child: const Text('再試行'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlaceholderScaffold extends StatelessWidget {
  final Widget child;

  const _PlaceholderScaffold({required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('テーマを編集')),
      body: child,
    );
  }
}

class _ThemeForm extends ConsumerStatefulWidget {
  final TaskTheme? theme;

  const _ThemeForm({this.theme});

  @override
  ConsumerState<_ThemeForm> createState() => _ThemeFormState();
}

class _ThemeFormState extends ConsumerState<_ThemeForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _directoryController;
  late final TextEditingController _descriptionController;
  String? _color;
  String? _categoryId;
  late bool _isDevelopment;
  bool _saving = false;

  /// 保存を一度押したか（カテゴリ未選択のエラー表示用）
  bool _submitted = false;

  bool get _isEdit => widget.theme != null;

  @override
  void initState() {
    super.initState();
    final theme = widget.theme;
    _nameController = TextEditingController(text: theme?.name ?? '');
    _directoryController =
        TextEditingController(text: theme?.workingDirectory ?? '');
    _descriptionController =
        TextEditingController(text: theme?.description ?? '');
    // 編集時は現在の色（パースできなければ未選択のまま＝色は送らない）
    _color = theme != null
        ? normalizeSwatchColor(theme.color)
        : defaultThemeColor;
    _categoryId = theme?.categoryId ?? theme?.category?.id;
    _isDevelopment = theme?.isDevelopment ?? false;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _directoryController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  /// 作成時はカテゴリ必須（POST /themes の categoryId は必須）
  bool _categoryMissing(List<TaskCategory> categories) =>
      !_isEdit && !categories.any((c) => c.id == _categoryId);

  Future<void> _save(List<TaskCategory> categories) async {
    if (_saving) return;
    setState(() => _submitted = true);
    final nameValid = _formKey.currentState?.validate() ?? false;
    if (!nameValid || _categoryMissing(categories)) return;

    setState(() => _saving = true);
    final editing = widget.theme;
    // 一覧に無いカテゴリ（取得失敗・削除済み）は送らない。編集で元のカテゴリが
    // 一覧に無い場合も、キーを省けばそのまま維持される
    final categoryId =
        categories.any((c) => c.id == _categoryId) ? _categoryId : null;
    final body = buildThemeFormBody(
      name: _nameController.text,
      color: _color,
      categoryId: categoryId,
      isDevelopment: _isDevelopment,
      workingDirectory: _directoryController.text,
      description: _descriptionController.text,
      isEdit: editing != null,
    );
    final messenger = ScaffoldMessenger.of(context);
    // 保存中に画面が破棄されても invalidate できるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);

    try {
      final service = ref.read(themeServiceProvider);
      if (editing == null) {
        await service.createTheme(body);
      } else {
        await service.updateTheme(editing.id, body);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text('テーマの保存に失敗しました: $e')),
      );
      return;
    }

    container.invalidate(themeListProvider);
    container.invalidate(taskListProvider);
    // テーマ件数（themeCount）が変わりうるのでカテゴリ一覧も取り直す
    container.invalidate(categoryListProvider);

    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(content: Text(editing == null ? 'テーマを作成しました' : 'テーマを更新しました')),
    );
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/themes');
    }
  }

  @override
  Widget build(BuildContext context) {
    final categoriesAsync = ref.watch(categoryListProvider);
    final themesAsync = ref.watch(themeListProvider);
    // カテゴリ一覧が取れなければ（エラー・空）テーマ群から導出したカテゴリで代替
    final fetched = categoriesAsync.valueOrNull;
    final List<TaskCategory> categories;
    if (fetched != null && fetched.isNotEmpty) {
      categories = fetched;
    } else if (categoriesAsync.isLoading && fetched == null) {
      categories = const [];
    } else {
      categories = categoriesFromThemes(themesAsync.valueOrNull ?? const []);
    }
    final loadingCategories = categoriesAsync.isLoading && fetched == null;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'テーマを編集' : '新しいテーマ')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: '名前',
                hintText: 'テーマの名前を入力',
              ),
              autofocus: !_isEdit,
              textInputAction: TextInputAction.next,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              validator: (value) => (value ?? '').trim().isEmpty
                  ? '名前を入力してください'
                  : null,
            ),
            const SizedBox(height: 24),
            Text('色', style: textTheme.titleSmall),
            const SizedBox(height: 8),
            ColorSwatchPicker(
              selected: _color,
              onChanged: (value) => setState(() => _color = value),
            ),
            const SizedBox(height: 24),
            if (loadingCategories)
              const LinearProgressIndicator()
            else
              _CategoryDropdown(
                categories: categories,
                value: categories.any((c) => c.id == _categoryId)
                    ? _categoryId
                    : null,
                errorText: _submitted && _categoryMissing(categories)
                    ? (categories.isEmpty
                        ? 'カテゴリがありません。先にカテゴリを作成してください'
                        : 'カテゴリを選択してください')
                    : null,
                onChanged: (value) => setState(() => _categoryId = value),
              ),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('開発テーマ'),
              subtitle: const Text('AIエージェントで実行するテーマ（作業フォルダも必要）'),
              value: _isDevelopment,
              onChanged: (value) => setState(() => _isDevelopment = value),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _directoryController,
              decoration: const InputDecoration(
                labelText: '作業フォルダ（任意）',
                hintText: '例: /Users/me/Projects/app',
                prefixIcon: Icon(Icons.folder_open),
              ),
              autocorrect: false,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: '説明（任意）',
                hintText: 'テーマの説明を入力',
                alignLabelWithHint: true,
              ),
              minLines: 3,
              maxLines: 6,
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _saving || loadingCategories
                  ? null
                  : () => _save(categories),
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_isEdit ? '保存' : '作成'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CategoryDropdown extends StatelessWidget {
  final List<TaskCategory> categories;
  final String? value;
  final String? errorText;
  final ValueChanged<String?> onChanged;

  const _CategoryDropdown({
    required this.categories,
    required this.value,
    required this.errorText,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        labelText: 'カテゴリ',
        prefixIcon: const Icon(Icons.folder_outlined),
        errorText: errorText,
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          isDense: true,
          hint: const Text('選択してください'),
          items: [
            for (final category in categories)
              DropdownMenuItem<String>(
                value: category.id,
                child: Row(
                  children: [
                    ColorDot(color: category.color, size: 10),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        category.name.isNotEmpty ? category.name : '名前なし',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
          ],
          onChanged: categories.isEmpty ? null : onChanged,
        ),
      ),
    );
  }
}
