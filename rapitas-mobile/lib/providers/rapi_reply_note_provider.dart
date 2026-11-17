import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/rapi_reply_note.dart';
import 'service_providers.dart';

// ラピの返答ごとの「ノートに保存」の状態（保存中・保存済み）。画面を開いている間だけ持つ。
//
// NOTE: 保存済みかどうかをサーバーへは問い合わせない（ブリーフィング nav66 の範囲）。
// 返答の行は一覧のスクロールで作り直されるので、状態は行の部品ではなくここに置く。
// autoDispose なので、ラピの画面を閉じれば消える。

/// 返答1件の保存の状態
enum RapiReplyNoteStatus { saving, saved }

/// 返答の鍵 → 保存の状態。鍵は [rapiReplyNoteKey]
class RapiReplyNoteNotifier extends AutoDisposeNotifier<Map<String, RapiReplyNoteStatus>> {
  @override
  Map<String, RapiReplyNoteStatus> build() => const {};

  void _set(String key, RapiReplyNoteStatus? status) {
    state = {
      for (final e in state.entries)
        if (e.key != key) e.key: e.value,
      if (status != null) key: status,
    };
  }

  /// 返答をノートに保存する。保存中・保存済みの返答には何もしない（二重に作らない）。
  ///
  /// @param key - 返答の鍵（[rapiReplyNoteKey]）
  /// @param question - 直前のユーザーの発言（無ければ null）
  /// @param answer - ラピの返答
  /// @param taskId - 紐付け先のタスク（相談のときだけ）
  /// @returns 保存の結果。既に保存中・保存済みなら null
  /// @throws Object ノートを保存できなかった（状態は未保存に戻す）
  Future<RapiReplyNoteSaved?> save(String key,
      {String? question, required String answer, String? taskId}) async {
    if (state.containsKey(key)) return null;
    _set(key, RapiReplyNoteStatus.saving);
    try {
      final saved = await saveRapiReplyNote(
        ref.read(noteServiceProvider),
        buildRapiReplyNote(question, answer),
        taskId: taskId,
      );
      _set(key, RapiReplyNoteStatus.saved);
      return saved;
    } catch (_) {
      _set(key, null);
      rethrow;
    }
  }
}

/// 返答ごとの「ノートに保存」の状態
final rapiReplyNoteProvider =
    NotifierProvider.autoDispose<RapiReplyNoteNotifier, Map<String, RapiReplyNoteStatus>>(
        RapiReplyNoteNotifier.new);

/// 返答の鍵。端末内の id は会話の読み直しで振り直されることがあるので、本文も含める
String rapiReplyNoteKey(int messageId, String text) => '$messageId:${text.hashCode}';
