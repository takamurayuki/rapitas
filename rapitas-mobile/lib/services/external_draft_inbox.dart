import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'home_screen_bridge.dart';

// ショートカット「ラピに依頼」から届いた依頼の、アプリ側の保存先（再起動しても残る）。
//
// ネイティブの置き場（ios/Runner/Intents の RapiPendingStore）から読んだ依頼は、まずここに書き、
// 書けてからネイティブ側を消す（ackPendingRequests）。ここから消すのは、ラピの画面でその依頼を
// 送れたとき・破棄したとき（rapi_chat_provider.dart の consumeExternalDraft）だけ。
// チャットの中身は保存されないので、送らずにアプリを終えても、次に開くとここから下書きに戻る。
//
// NOTE: 消した依頼の番号はしばらく覚えておく（[consumedMemory] 件）。ネイティブ側の消去が届かず
// 同じ依頼をもう一度読んでも、送り終えた依頼が下書きに戻らないようにするため。

/// 届いた依頼の保存先（テストでは SharedPreferences.setMockInitialValues を使う）
class ExternalDraftInbox {
  static const String draftsKey = 'rapiExternalDrafts.v1';
  static const String consumedKey = 'rapiExternalDraftsConsumed.v1';

  /// 消した依頼の番号を覚えておく件数
  static const int consumedMemory = 50;

  /// 読み書きを1本につなぐ（await の合間に別の読み書きが割り込んで、片方の書き込みが消えないように）
  Future<void> _tail = Future.value();

  Future<T> _serial<T>(Future<T> Function() body) {
    final result = _tail.then((_) => body());
    _tail = result.then((_) {}, onError: (_) {});
    return result;
  }

  static List<PendingRapiRequest> _readDrafts(SharedPreferences prefs) {
    final raw = prefs.getString(draftsKey);
    if (raw == null) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return [
        for (final item in decoded)
          if (PendingRapiRequest.tryParse(item) case final r?) r,
      ];
    } on FormatException {
      return [];
    }
  }

  /// @returns 書けたか（SharedPreferences.setString の結果）
  static Future<bool> _writeDrafts(SharedPreferences prefs, List<PendingRapiRequest> drafts) =>
      prefs.setString(draftsKey, jsonEncode([for (final d in drafts) d.toJson()]));

  /// 保存している依頼（届いた順）
  Future<List<PendingRapiRequest>> load() =>
      _serial(() async => _readDrafts(await SharedPreferences.getInstance()));

  /// 依頼を足して保存する。すでにある依頼と、送り終えた・破棄した依頼は足さない
  ///
  /// @param requests - ネイティブから読んだ依頼 / HomeScreenBridge.peekPendingRequests
  /// @returns 足したあとに保存している依頼（届いた順）
  /// @throws 保存に失敗したとき（呼び出し側はネイティブ側を消さない）
  Future<List<PendingRapiRequest>> addAll(List<PendingRapiRequest> requests) => _serial(() async {
        final prefs = await SharedPreferences.getInstance();
        final drafts = _readDrafts(prefs);
        if (requests.isEmpty) return drafts;
        final consumed = prefs.getStringList(consumedKey) ?? const <String>[];
        final known = {...drafts.map((d) => d.id), ...consumed};
        final added = [for (final r in requests) if (known.add(r.id)) r];
        if (added.isEmpty) return drafts;
        final next = [...drafts, ...added];
        if (!await _writeDrafts(prefs, next)) {
          throw StateError('failed to save external drafts');
        }
        return next;
      });

  /// 依頼を消す（送れた・破棄した）
  ///
  /// @param id - 消す依頼の番号 / PendingRapiRequest.id
  Future<void> consume(String id) => _serial(() async {
        final prefs = await SharedPreferences.getInstance();
        final drafts = _readDrafts(prefs);
        await _writeDrafts(prefs, [for (final d in drafts) if (d.id != id) d]);
        final consumed = [...?prefs.getStringList(consumedKey), id];
        await prefs.setStringList(
          consumedKey,
          consumed.length > consumedMemory
              ? consumed.sublist(consumed.length - consumedMemory)
              : consumed,
        );
      });
}

final externalDraftInboxProvider = Provider<ExternalDraftInbox>((ref) => ExternalDraftInbox());
