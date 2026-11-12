import '../models/rapi_chat/saved_message.dart';
import 'rapi_chat_space_service.dart';

// 会話スペースの読み込み（設計 nav39 6.3）。
//
// 最新の50件を読み、turns に入る行が [turnTarget] 件そろうまで（または履歴の先頭まで）前のページを
// 100件ずつ足す。1スペースは最大2,000件なので、足す読み込みは最大20回で止まる。途中で失敗したら、
// そこまでの分で始める（「前の会話を読み込む」で続きを読める）。

/// 最初のページの件数
const int rapiFirstPageLimit = 50;

/// 足して読むページの件数（サーバーの上限）
const int rapiMorePageLimit = 100;

/// 足す読み込みの最大回数（2,000件 ÷ 100件）
const int rapiMaxExtraPages = 20;

/// 読み込んだ記録（古い順）と、続きがあるか
class RapiLoadedRows {
  final List<SavedMessage> rows;
  final bool hasMore;
  final int? nextBefore;

  const RapiLoadedRows(this.rows, {this.hasMore = false, this.nextBefore});
}

/// スペース [spaceId] の最新ページを読み、turns をそろえる
///
/// [countsAsTurn] は provider の turns の条件と同じ関数を渡す（条件を2か所に書かない）。
/// @throws RapiSpaceNotFound スペースが無いとき。最初のページが読めないときはその例外
Future<RapiLoadedRows> loadSpaceRows(
  RapiChatSpaceService service,
  int spaceId, {
  required bool Function(SavedMessage) countsAsTurn,
  int turnTarget = 10,
}) async {
  final first = await service.loadMessages(spaceId, limit: rapiFirstPageLimit);
  var rows = first.messages;
  var hasMore = first.hasMore;
  var nextBefore = first.nextBefore;
  var extra = 0;
  while (hasMore && extra < rapiMaxExtraPages && rows.where(countsAsTurn).length < turnTarget) {
    extra++;
    final RapiMessagePage page;
    try {
      page = await service.loadMessages(spaceId, before: nextBefore, limit: rapiMorePageLimit);
    } on Object {
      break;
    }
    rows = [...page.messages, ...rows];
    hasMore = page.hasMore;
    nextBefore = page.nextBefore;
  }
  return RapiLoadedRows(rows, hasMore: hasMore, nextBefore: nextBefore);
}

/// 読み込んだ記録 [rows] に、まだ送れていない保存待ち [pending] を clientId で重ねる（設計 6.3）。
/// deleted の行は出さない。同じ clientId は保存待ちの版で置き換え、無いものは列の順で末尾に足す
List<SavedMessage> overlayPending(List<SavedMessage> rows, List<SavedMessage> pending) {
  final out = [...rows];
  for (final p in pending) {
    final i = out.indexWhere((r) => r.clientId == p.clientId);
    if (p.deleted) {
      if (i >= 0) out.removeAt(i);
    } else if (i >= 0) {
      out[i] = p;
    } else {
      out.add(p);
    }
  }
  return out;
}
