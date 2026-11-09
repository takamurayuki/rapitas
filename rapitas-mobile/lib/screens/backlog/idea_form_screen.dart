import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/backlog_service.dart';
import '../../widgets/voice_mode_indicator.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// アイデアの追加フォーム（/ideas/new）。テーマは選ばない（scope は 'global' 固定）。
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
    final body = buildIdeaCreateBody(
      title: _titleController.text,
      content: _contentController.text,
      priority: _priority,
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新しいアイデア'), actions: const [VoiceModeIndicator()]),
      body: Form(
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
              autofocus: true,
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
    );
  }
}
