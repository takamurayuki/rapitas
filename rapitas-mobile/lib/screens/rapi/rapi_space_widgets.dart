import 'package:flutter/material.dart';

import '../../providers/rapi_chat_provider.dart';
import '../../widgets/rapi_avatar.dart';

// ラピの画面の、会話スペースまわりの部品（設計 nav39 5.2・6.3・8.5。見た目は
// hidden_files/ui-preview/rapi-spaces-mock.html）。
// - AppBar のタイトル（アバター＋「{スペース名} ▾」。タップで一覧のシート）
// - 読み込み中・前の会話を読み込む・読み込めなかった の行
// - 読み込んだ記録のカードの枠（「記録」の印・保存した日時・段階の注記）

const double _avatarSize = 64;
const double _avatarHeight = _avatarSize * 134 / 120;
const Color _violet = Color(0xFF7C3AED);
const Color _warnAmber = Color(0xFFB45309);

/// AppBar のタイトル：ラピ本体と、その真下にスペース名と ▾（設計 8.5・Q4）
class RapiSpaceTitle extends StatelessWidget {
  final String title;
  final VoidCallback onTap;

  const RapiSpaceTitle({super.key, required this.title, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Semantics(
      button: true,
      label: '会話の一覧を開く（いまの会話：$title）',
      child: InkWell(
        key: const ValueKey('rapi-space-title'),
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: _avatarSize,
                height: _avatarHeight,
                child: Align(alignment: Alignment.topCenter, child: RapiAvatar(size: _avatarSize)),
              ),
              const SizedBox(height: 1),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 160),
                    child: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 10, fontWeight: FontWeight.w600, height: 1.2, color: muted),
                    ),
                  ),
                  Icon(Icons.arrow_drop_down, size: 14, color: muted),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ラピの発言と同じ白いカードに、小さなスピナーと文（「読み込み中…」）
class RapiSpaceLoadingRow extends StatelessWidget {
  const RapiSpaceLoadingRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('rapi-space-loading'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE4E4E7)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Row(
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF8B5CF6)),
          ),
          SizedBox(width: 8),
          Text('読み込み中…', style: TextStyle(fontSize: 14, color: Color(0xFF6B7280))),
        ],
      ),
    );
  }
}

/// 一覧の先頭の「前の会話を読み込む」
class RapiLoadMoreRow extends StatelessWidget {
  final bool loading;
  final VoidCallback onTap;

  const RapiLoadMoreRow({super.key, required this.loading, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: loading
          ? const Padding(
              padding: EdgeInsets.all(12),
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2, color: _violet),
              ),
            )
          : TextButton(
              key: const ValueKey('rapi-space-load-more'),
              style: TextButton.styleFrom(foregroundColor: _violet),
              onPressed: onTap,
              // 文字の大きさは Text 側で指定する（styleFrom の textStyle は周りのフォント指定を引き継がない）
              child: const Text('前の会話を読み込む',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            ),
    );
  }
}

/// 読み込めなかったときの行。[onNew] が null なら「新しい会話を始める」を出さない（設計 6.3 の例外）
class RapiLoadFailedRow extends StatelessWidget {
  final VoidCallback onRetry;
  final VoidCallback? onNew;

  const RapiLoadFailedRow({super.key, required this.onRetry, this.onNew});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final style = TextButton.styleFrom(foregroundColor: _violet, visualDensity: VisualDensity.compact);
    const label = TextStyle(fontSize: 12, fontWeight: FontWeight.w600);
    return Center(
      key: const ValueKey('rapi-space-load-failed'),
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text('会話を読み込めませんでした', style: TextStyle(fontSize: 12, color: muted, height: 1.4)),
          TextButton(
              key: const ValueKey('rapi-space-retry'), style: style, onPressed: onRetry, child: const Text('もう一度', style: label)),
          if (onNew != null)
            TextButton(
                key: const ValueKey('rapi-space-start-new'),
                style: style,
                onPressed: onNew,
                child: const Text('新しい会話を始める', style: label)),
        ],
      ),
    );
  }
}

/// 記録のカードの段階の注記（設計 5.2）。注記が要らなければ null
(String, bool)? rapiArchivedNote(RapiMessage m) {
  const open = ('このときは確定していません', false);
  const unknown = ('結果を確かめられませんでした。タスクを開いて確認してください', true);
  if (m.change case final c?) {
    return switch (c.phase) {
      RapiChangePhase.proposed => open,
      RapiChangePhase.applying || RapiChangePhase.reverting || RapiChangePhase.applyUnknown => unknown,
      _ => null,
    };
  }
  if (m.roadmap case final r?) {
    return switch (r.phase) {
      RapiRoadmapPhase.questions || RapiRoadmapPhase.ready => open,
      RapiRoadmapPhase.refining || RapiRoadmapPhase.committing || RapiRoadmapPhase.commitUnknown => unknown,
      _ => null,
    };
  }
  if (m.tidy case final t?) {
    if (t.restoring) return unknown;
    return switch (t.phase) {
      RapiTidyPhase.setup || RapiTidyPhase.listing => open,
      RapiTidyPhase.searching || RapiTidyPhase.deleting => unknown,
      _ => null,
    };
  }
  if (m.companion case final c?) {
    return switch (c.phase) {
      RapiCompanionPhase.proposed => open,
      RapiCompanionPhase.applying || RapiCompanionPhase.applyUnknown => unknown,
      _ => null,
    };
  }
  if (m.answer != null) return ('この時点の結果です（件数は今と違うことがあります）', false);
  return null;
}

String _stamp(DateTime? at) {
  if (at == null) return '記録';
  final d = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '記録 · ${d.month}/${d.day} ${two(d.hour)}:${two(d.minute)}';
}

/// 読み込んだ記録のカードの枠：上に「記録・保存した日時」、下に段階の注記
class RapiArchivedFrame extends StatelessWidget {
  final RapiMessage message;
  final Widget child;

  const RapiArchivedFrame({super.key, required this.message, required this.child});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final note = rapiArchivedNote(message);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 4),
          child: Row(
            children: [
              Icon(Icons.history, size: 13, color: muted),
              const SizedBox(width: 4),
              Text(_stamp(message.savedAt), style: TextStyle(fontSize: 11, color: muted)),
            ],
          ),
        ),
        if (message.unsupported) ...[
          if (message.text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6, left: 4, right: 4),
              child: Text(message.text, style: const TextStyle(fontSize: 14, height: 1.5)),
            ),
          const RapiUnsupportedCard(),
        ] else
          child,
        if (note != null && !message.unsupported)
          Container(
            key: ValueKey('rapi-archived-note-${message.id}'),
            width: double.infinity,
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: note.$2 ? const Color(0xFFFEF3C7) : const Color(0xFFF4F4F5),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(note.$1,
                style: TextStyle(
                    fontSize: 12, height: 1.4, color: note.$2 ? _warnAmber : const Color(0xFF52525B))),
          ),
      ],
    );
  }
}

/// 形が新しすぎる・知らない種類の記録の、カードの位置に出す案内（設計 3.4）
class RapiUnsupportedCard extends StatelessWidget {
  const RapiUnsupportedCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F4F5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Text('この記録は新しいアプリで保存されたため表示できません',
          style: TextStyle(fontSize: 12.5, color: Color(0xFF52525B), height: 1.4)),
    );
  }
}
