import '../models/companion_digest.dart';
import 'api_client.dart';

/// 伴走の要約の読み出しと「ここまで見せた」の報告（/assistant/companion/digest）。
///
/// どちらも判断ではない（読むのと、表示の既読位置を進めるだけ）ので、普通の ApiClient で送る。
/// X-Rapitas-Source は付けない（判断画面からの呼び出しだけが付ける。human_decision_client.dart）
class CompanionDigestService {
  final ApiClient _client;

  CompanionDigestService(this._client);

  Future<CompanionDigest> getDigest() async {
    final response = await _client.get('/assistant/companion/digest');
    return CompanionDigest.fromJson((response.data as Map).cast<String, dynamic>());
  }

  /// 表示した要約の位置を返す。新しい動きが無かった項目（cursor が null）は送らない
  Future<void> markSeen(Iterable<DigestItem> shown) async {
    final cursors = [
      for (final item in shown)
        if (item.cursor != null) {'taskId': int.parse(item.taskId), 'transitionId': item.cursor},
    ];
    if (cursors.isEmpty) return;
    await _client.post('/assistant/companion/digest/seen', data: {'cursors': cursors});
  }
}
