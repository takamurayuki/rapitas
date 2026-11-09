import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/task.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../widgets/color_swatch_picker.dart';
import '../../widgets/voice_mode_indicator.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// カテゴリのモード（Category.mode）と表示名
const Map<String, String> categoryModeLabels = {
  'development': '開発',
  'learning': '学習',
  'both': '両方',
};

/// カテゴリ作成・更新 API に送るボディを作る。
///
/// 値の無い項目はキーごと省く（null は送らない）。編集時に説明を空にした場合だけは
/// 消したことを伝えるため空文字を送る。モードは既知の値（development/learning/both）だけ送る。
///
/// @param name - カテゴリ名 / 前後の空白は落とす
/// @param color - 色（'#RRGGBB'）/ null ならキーを省く
/// @param description - 説明 / 空なら作成時は省略、編集時は空文字
/// @param mode - モード / 未知の値・null ならキーを省く
/// @param isEdit - 編集（PATCH）用のボディか
/// @returns リクエストボディ / null を含まない Map
Map<String, dynamic> buildCategoryFormBody({
  required String name,
  String? color,
  String? description,
  String? mode,
  bool isEdit = false,
}) {
  final trimmedDescription = description?.trim() ?? '';
  return {
    'name': name.trim(),
    if (color != null) 'color': color,
    if (trimmedDescription.isNotEmpty)
      'description': trimmedDescription
    else if (isEdit)
      'description': '',
    if (mode != null && categoryModeLabels.containsKey(mode)) 'mode': mode,
  };
}

/// カテゴリの作成・編集フォーム。categoryId も category も無ければ作成。
class CategoryFormScreen extends ConsumerStatefulWidget {
  /// 編集対象のカテゴリID（`/categories/:id/edit`）
  final String? categoryId;

  /// 編集対象のカテゴリ（go_router の extra）。無ければ categoryListProvider から探す
  final TaskCategory? category;

  const CategoryFormScreen({super.key, this.categoryId, this.category});

  @override
  ConsumerState<CategoryFormScreen> createState() => _CategoryFormScreenState();
}

class _CategoryFormScreenState extends ConsumerState<CategoryFormScreen> {
  /// 見つからず閉じる処理を予約済みか（再ビルドで二重に pop しないため）
  bool _closing = false;

  void _closeNotFound() {
    if (_closing) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('カテゴリが見つかりませんでした')),
      );
      if (context.canPop()) {
        context.pop();
      } else {
        context.go('/categories');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final initial = widget.category;
    final id = widget.categoryId;
    if (initial != null || id == null) {
      return _CategoryForm(category: initial);
    }

    final categoriesAsync = ref.watch(categoryListProvider);
    return categoriesAsync.when(
      data: (categories) {
        for (final c in categories) {
          if (c.id == id) return _CategoryForm(category: c);
        }
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
              const Text('カテゴリの取得に失敗しました'),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: () => ref.invalidate(categoryListProvider),
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
      appBar: AppBar(title: const Text('カテゴリを編集'), actions: const [VoiceModeIndicator()]),
      body: child,
    );
  }
}

class _CategoryForm extends ConsumerStatefulWidget {
  final TaskCategory? category;

  const _CategoryForm({this.category});

  @override
  ConsumerState<_CategoryForm> createState() => _CategoryFormState();
}

class _CategoryFormState extends ConsumerState<_CategoryForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  String? _color;
  String? _mode;
  bool _saving = false;

  bool get _isEdit => widget.category != null;

  @override
  void initState() {
    super.initState();
    final category = widget.category;
    _nameController = TextEditingController(text: category?.name ?? '');
    _descriptionController =
        TextEditingController(text: category?.description ?? '');
    _color = category != null
        ? normalizeSwatchColor(category.color)
        : presetSwatchColors.first;
    final mode = category?.mode;
    _mode = mode != null && categoryModeLabels.containsKey(mode) ? mode : null;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final editing = widget.category;
    final body = buildCategoryFormBody(
      name: _nameController.text,
      color: _color,
      description: _descriptionController.text,
      mode: _mode,
      isEdit: editing != null,
    );
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);

    try {
      final service = ref.read(categoryServiceProvider);
      if (editing == null) {
        await service.createCategory(body);
      } else {
        await service.updateCategory(editing.id, body);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text('カテゴリの保存に失敗しました: $e')),
      );
      return;
    }

    container.invalidate(categoryListProvider);
    // テーマに埋め込まれたカテゴリ（名前・色）も変わるのでテーマ一覧も取り直す
    container.invalidate(themeListProvider);

    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(content: Text(editing == null ? 'カテゴリを作成しました' : 'カテゴリを更新しました')),
    );
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/categories');
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'カテゴリを編集' : '新しいカテゴリ'), actions: const [VoiceModeIndicator()]),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: '名前',
                hintText: 'カテゴリの名前を入力',
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
            InputDecorator(
              decoration: const InputDecoration(
                labelText: 'モード',
                prefixIcon: Icon(Icons.tune),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _mode,
                  isExpanded: true,
                  isDense: true,
                  hint: const Text('未設定'),
                  items: [
                    for (final entry in categoryModeLabels.entries)
                      DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (value) => setState(() => _mode = value),
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: '説明（任意）',
                hintText: 'カテゴリの説明を入力',
                alignLabelWithHint: true,
              ),
              minLines: 3,
              maxLines: 6,
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _saving ? null : _save,
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
