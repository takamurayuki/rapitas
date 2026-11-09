import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/backlog_service.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// 懸念の追加フォーム（/concerns/new）。タイトル・詳細は必須（バックエンドも必須）。
class ConcernFormScreen extends ConsumerStatefulWidget {
  const ConcernFormScreen({super.key});

  @override
  ConsumerState<ConcernFormScreen> createState() => _ConcernFormScreenState();
}

class _ConcernFormScreenState extends ConsumerState<ConcernFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _detailController = TextEditingController();
  final _locationController = TextEditingController();
  // 既定値はデスクトップの追加フォームと同じ
  String _type = 'bug';
  String _severity = 'medium';
  bool _saving = false;

  @override
  void dispose() {
    _titleController.dispose();
    _detailController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final body = buildConcernCreateBody(
      title: _titleController.text,
      detail: _detailController.text,
      type: _type,
      severity: _severity,
      location: _locationController.text,
    );
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);

    final bool stored;
    try {
      stored = await ref.read(backlogServiceProvider).createConcern(body);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text('懸念の登録に失敗しました: $e')));
      return;
    }

    container.invalidate(concernListProvider);
    if (!mounted) return;
    messenger.showSnackBar(SnackBar(
      content: Text(stored
          ? '懸念を登録しました'
          : '同じような懸念が既にあるため、新しくは登録しませんでした'),
    ));
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/concerns');
    }
  }

  Widget _dropdown({
    required String label,
    required IconData icon,
    required String value,
    required List<String> values,
    required Map<String, String> labels,
    required ValueChanged<String> onChanged,
  }) {
    return InputDecorator(
      decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          isDense: true,
          items: [
            for (final v in values)
              DropdownMenuItem<String>(value: v, child: Text(labels[v] ?? v)),
          ],
          onChanged: _saving
              ? null
              : (v) {
                  if (v != null) onChanged(v);
                },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新しい懸念')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'タイトル',
                hintText: '気になっていることを一言で',
              ),
              autofocus: true,
              textInputAction: TextInputAction.next,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              validator: (value) => (value ?? '').trim().isEmpty
                  ? 'タイトルを入力してください'
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _detailController,
              decoration: const InputDecoration(
                labelText: '詳細',
                hintText: '何が問題か、どこで起きるか',
                alignLabelWithHint: true,
              ),
              minLines: 4,
              maxLines: 10,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              validator: (value) => (value ?? '').trim().isEmpty
                  ? '詳細を入力してください'
                  : null,
            ),
            const SizedBox(height: 16),
            _dropdown(
              label: '種別',
              icon: Icons.category_outlined,
              value: _type,
              values: concernTypeLabels.keys.toList(),
              labels: concernTypeLabels,
              onChanged: (v) => setState(() => _type = v),
            ),
            const SizedBox(height: 16),
            _dropdown(
              label: '重要度',
              icon: Icons.flag_outlined,
              value: _severity,
              values: backlogPriorityOrder,
              labels: concernSeverityLabels,
              onChanged: (v) => setState(() => _severity = v),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _locationController,
              decoration: const InputDecoration(
                labelText: '場所（任意）',
                hintText: '例: lib/screens/home/home_screen.dart',
              ),
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
                  : const Text('登録'),
            ),
          ],
        ),
      ),
    );
  }
}
