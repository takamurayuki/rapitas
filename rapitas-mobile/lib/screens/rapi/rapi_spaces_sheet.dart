import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/rapi_chat_spaces_provider.dart';
import '../../services/rapi_chat_space_service.dart';
import '../../widgets/swipe_to_delete.dart';

// ラピの会話の一覧（タイトルをタップすると開くボトムシート。設計 nav39 8.1・8.2・8.4）。
// 上から「会話」の見出し・「＋ 新しい会話」・スペースの行（新しい順。いま開いている行に印）。
// 行のタップで開き、右から左への横スワイプ＋確認ダイアログで消す。シートを開くたびに読み直す。

/// 応答待ち・処理中に切り替えようとしたときの案内（設計 6.2 の 1）
const String rapiBusySwitchMessage = 'ラピの応答を待っています';

/// 未作成の会話から移ったときの案内（設計 6.5 の 6）
const String rapiLeftUnsavedMessage = 'この会話は接続が戻ると保存され、一覧に出ます';

/// 一覧の相対日時（3分前・昨日・11/10 など）
String rapiRelativeTime(DateTime? at, {DateTime? now}) {
  if (at == null) return '';
  final n = (now ?? DateTime.now()).toLocal();
  final t = at.toLocal();
  final diff = n.difference(t);
  if (diff.inMinutes < 1) return 'たった今';
  if (diff.inMinutes < 60) return '${diff.inMinutes}分前';
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  if (day == today) return '${diff.inHours}時間前';
  if (today.difference(day).inDays == 1) return '昨日';
  return t.year == n.year ? '${t.month}/${t.day}' : '${t.year}/${t.month}/${t.day}';
}

/// 削除の確認の文（Q1：消えるのは会話の記録だけ）
String rapiDeleteSpaceMessage(String title) =>
    '「$title」を削除しますか？この会話の記録はすべての端末から消え、元に戻せません。'
    '作ったタスクや操作の記録は消えません。';

void _report(ScaffoldMessengerState messenger, RapiSwitchOutcome outcome) {
  final text = switch (outcome) {
    RapiSwitchOutcome.busy => rapiBusySwitchMessage,
    RapiSwitchOutcome.switchedLeavingUnsaved => rapiLeftUnsavedMessage,
    _ => null,
  };
  if (text != null) messenger.showSnackBar(SnackBar(content: Text(text)));
}

/// 会話の一覧のシートを開く。[onNewConversation] は新しい会話を開いたあと（欄にフォーカスする）
Future<void> showRapiSpacesSheet(BuildContext context, {VoidCallback? onNewConversation}) {
  final messenger = ScaffoldMessenger.of(context);
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => _SpacesSheet(
      messenger: messenger,
      onNewConversation: onNewConversation,
    ),
  );
}

class _SpacesSheet extends ConsumerStatefulWidget {
  final ScaffoldMessengerState messenger;
  final VoidCallback? onNewConversation;

  const _SpacesSheet({required this.messenger, this.onNewConversation});

  @override
  ConsumerState<_SpacesSheet> createState() => _SpacesSheetState();
}

class _SpacesSheetState extends ConsumerState<_SpacesSheet> {
  List<RapiSpaceSummary>? _spaces;
  bool _failed = false;

  RapiChatSpacesNotifier get _notifier => ref.read(rapiChatSpacesProvider.notifier);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final spaces = await _notifier.listSpaces();
      if (mounted) setState(() => _spaces = spaces);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  void _newConversation() {
    final outcome = _notifier.newConversation();
    Navigator.pop(context);
    _report(widget.messenger, outcome);
    if (outcome != RapiSwitchOutcome.busy) widget.onNewConversation?.call();
  }

  Future<void> _open(RapiSpaceSummary space) async {
    Navigator.pop(context);
    _report(widget.messenger, await _notifier.openSpace(space));
  }

  Future<bool> _delete(RapiSpaceSummary space) async {
    final current = ref.read(rapiChatSpacesProvider).spaceId == space.id;
    if (current && ref.read(rapiChatSpacesProvider.notifier).busy) {
      _report(widget.messenger, RapiSwitchOutcome.busy);
      return false;
    }
    final ok = await confirmBacklogDelete(
        context, rapiDeleteSpaceMessage(space.title ?? rapiNewSpaceTitle));
    if (!ok) return false;
    try {
      _report(widget.messenger, await _notifier.deleteSpace(space.id));
      return true;
    } catch (_) {
      widget.messenger.showSnackBar(const SnackBar(content: Text('会話を削除できませんでした')));
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final current = ref.watch(rapiChatSpacesProvider);
    final spaces = _spaces;
    const violet = Color(0xFF7C3AED);
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text('会話', style: theme.textTheme.titleMedium),
            ),
            ListTile(
              key: const ValueKey('rapi-space-new'),
              contentPadding: const EdgeInsets.symmetric(horizontal: 24),
              leading: const Icon(Icons.add, color: violet),
              title: const Text('新しい会話',
                  style: TextStyle(color: violet, fontWeight: FontWeight.w600)),
              // 「新しい会話」（まだサーバーに無い）を開いているときは、ここに印を付ける（設計 8.1）
              selected: current.isNew,
              trailing: current.isNew ? const Icon(Icons.check, color: violet) : null,
              onTap: _newConversation,
            ),
            if (spaces == null && !_failed)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            if (_failed)
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
                child: Text('一覧を読み込めませんでした',
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
              ),
            for (final s in spaces ?? const <RapiSpaceSummary>[])
              BacklogSwipeToDelete(
                key: ValueKey('rapi-space-row-${s.id}'),
                itemKey: ValueKey('rapi-space-dismiss-${s.id}'),
                onConfirmDelete: () => _delete(s),
                onDismissed: () => setState(() => _spaces = [
                      for (final x in _spaces ?? const <RapiSpaceSummary>[])
                        if (x.id != s.id) x,
                    ]),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 24),
                  leading: const Icon(Icons.chat_bubble_outline),
                  title: Text(
                    s.title?.trim().isNotEmpty == true ? s.title! : rapiNewSpaceTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(rapiRelativeTime(s.activityAt)),
                  selected: s.id == current.spaceId,
                  selectedTileColor: theme.colorScheme.secondaryContainer,
                  trailing: s.id == current.spaceId ? const Icon(Icons.check, color: violet) : null,
                  onTap: () => _open(s),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
