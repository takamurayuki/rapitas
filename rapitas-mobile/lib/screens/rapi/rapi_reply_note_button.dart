import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/note_paths.dart';
import '../../models/rapi_chat/rapi_chat_message.dart';
import '../../providers/rapi_reply_note_provider.dart';
import '../../services/rapi_reply_note.dart';

// ラピの文章の返答カードの下部に置く「ノートに保存」。保存後は「保存済み」になり、もう送らない。
// ノートの組み立てと書き込みは services/rapi_reply_note.dart、状態は providers/rapi_reply_note_provider.dart。

/// 保存できたときの文言
const String rapiNoteSavedMessage = 'ノートに保存しました';

/// ノートは保存できたが、タスクへの紐付けだけ失敗したときの文言
const String rapiNoteLinkFailedMessage = 'ノートに保存しました（タスクへの紐付けは失敗しました）';

/// ノート自体を保存できなかったときの文言
const String rapiNoteFailedMessage = 'ノートに保存できませんでした';

const Color _muted = Color(0xFF6B7280);
const Color _savedColor = Color(0xFF059669);

/// 返答 [m] のカードに付ける「ノートに保存」。挨拶（端末だけの行）と空の返答には付けない。
///
/// @param chat - 会話の状態（直前の質問を探す）
/// @param m - ラピの返答
/// @returns ボタン。付けない返答なら null
Widget? rapiReplyNoteFooter(RapiChatState chat, RapiMessage m) {
  if (m.localOnly || m.text.trim().isEmpty) return null;
  return RapiReplyNoteButton(
    key: ValueKey('rapi-save-note-${m.id}'),
    noteKey: rapiReplyNoteKey(m.id, m.text),
    question: rapiQuestionBefore(chat.messages, m),
    answer: m.text,
    taskId: m.consultTaskId,
  );
}

/// 小さな「ノートに保存」ボタン（アイコン＋文言）。押すと保存し、スナックバーで結果を出す。
class RapiReplyNoteButton extends ConsumerWidget {
  /// 返答の鍵（[rapiReplyNoteKey]）
  final String noteKey;
  final String? question;
  final String answer;

  /// 相談中のタスク。あればノートをそのタスクへ紐付ける
  final String? taskId;

  const RapiReplyNoteButton({
    super.key,
    required this.noteKey,
    required this.question,
    required this.answer,
    this.taskId,
  });

  Future<void> _save(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    // NOTE: 保存を待つ間に画面を離れても遷移できるよう、ルーターは先に取っておく
    final router = GoRouter.maybeOf(context);
    try {
      final saved = await ref
          .read(rapiReplyNoteProvider.notifier)
          .save(noteKey, question: question, answer: answer, taskId: taskId);
      if (saved == null) return;
      messenger?.showSnackBar(SnackBar(
        content: Text(saved.linked == false ? rapiNoteLinkFailedMessage : rapiNoteSavedMessage),
        action: router == null
            ? null
            : SnackBarAction(
                label: '開く',
                onPressed: () => router.push(NotePaths.detailPath(saved.noteId)),
              ),
      ));
    } catch (_) {
      messenger?.showSnackBar(const SnackBar(content: Text(rapiNoteFailedMessage)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(rapiReplyNoteProvider.select((s) => s[noteKey]));
    final saved = status == RapiReplyNoteStatus.saved;
    final saving = status == RapiReplyNoteStatus.saving;
    final color = saved ? _savedColor : _muted;
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton.icon(
        onPressed: status == null ? () => _save(context, ref) : null,
        style: TextButton.styleFrom(
          foregroundColor: color,
          disabledForegroundColor: color,
          padding: const EdgeInsets.symmetric(horizontal: 6),
          minimumSize: const Size(0, 30),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          visualDensity: VisualDensity.compact,
          // NOTE: テーマの文字設定から作る（素の TextStyle だとボタン既定の書体の指定まで消える）
          textStyle: Theme.of(context).textTheme.labelMedium?.copyWith(fontSize: 12),
        ),
        icon: saving
            ? const SizedBox(
                width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 1.6))
            : Icon(saved ? Icons.check : Icons.description_outlined, size: 16),
        label: Text(saved ? '保存済み' : saving ? '保存中…' : 'ノートに保存'),
      ),
    );
  }
}
