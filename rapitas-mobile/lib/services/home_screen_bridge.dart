import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// iOS のホーム画面まわり（ウィジェット・ショートカット）とのやりとり。
//
// 相手は ios/Runner/RapiHomeScreenChannel.swift（MethodChannel `rapitas/home_screen`）。
// - writeWidgetSnapshot：ウィジェットに出す値（表示用だけ。トークンや URL は入れない）を
//   App Group の共有 UserDefaults に書き、WidgetKit に描き直しを頼む
// - peekPendingRequests / ackPendingRequests：ショートカット「ラピに依頼」がアプリに預けた依頼を読み、
//   Dart 側で保存し終えた分だけ消す（2段階。読んですぐ消すと、保存前にアプリが終わったとき失われる）
//
// NOTE: iOS 以外（Android・テスト）には相手がいないので、[isSupported] が false なら何もしない。

/// ショートカットから預かった依頼1件
class PendingRapiRequest {
  /// ネイティブが振った番号（ackPendingRequests と、二重取り込みの見分けに使う）
  final String id;
  final String text;
  final DateTime? createdAt;

  /// 預けた理由：needs_confirmation（アプリでの確認が要る依頼）/ offline / unauthorized /
  /// timeout / locked / unpaired（送れなかった）
  final String reason;

  const PendingRapiRequest({
    required this.id,
    required this.text,
    this.createdAt,
    this.reason = 'needs_confirmation',
  });

  /// アプリでの確認が要るだけで、送信自体は失敗していないか
  bool get needsConfirmationOnly => reason == 'needs_confirmation';

  /// ネイティブから届いた1件、または external_draft_inbox.dart が保存した1件を読む。本文が空なら null
  ///
  /// @param raw - {id, text, createdAt, reason} / MethodChannel の値・保存した JSON
  /// @returns 依頼。読めなければ null
  static PendingRapiRequest? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final text = raw['text'];
    if (text is! String || text.trim().isEmpty) return null;
    final created = raw['createdAt'];
    final reason = raw['reason'];
    final id = raw['id'];
    return PendingRapiRequest(
      // NOTE: 番号のない値は来ない想定（ネイティブが必ず振る）。来たら中身から作り、同じ依頼が同じ番号になるようにする
      id: id is String && id.isNotEmpty ? id : 'legacy:${created ?? ''}:${text.trim()}',
      text: text.trim(),
      createdAt: created is String ? DateTime.tryParse(created) : null,
      reason: reason is String && reason.isNotEmpty ? reason : 'needs_confirmation',
    );
  }

  /// 保存用の形（tryParse で読み戻せる）
  Map<String, Object?> toJson() => {
        'id': id,
        'text': text,
        'createdAt': createdAt?.toUtc().toIso8601String(),
        'reason': reason,
      };
}

/// ホーム画面まわりのネイティブ機能の窓口（テストでは差し替える）
abstract class HomeScreenBridge {
  /// この端末でウィジェットとショートカットが使えるか
  bool get isSupported;

  /// ウィジェットのスナップショットを書き、描き直しを頼む
  ///
  /// @param snapshot - 表示用の値だけの JSON / home_widget_sync_provider.dart の buildWidgetSnapshot
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot);

  /// ショートカットが預けた依頼を古い順に読む（ネイティブ側からは消えない）
  Future<List<PendingRapiRequest>> peekPendingRequests();

  /// 受け取って保存し終えた依頼をネイティブ側から消す
  ///
  /// @param ids - 消す依頼の番号 / PendingRapiRequest.id
  Future<void> ackPendingRequests(List<String> ids);
}

/// MethodChannel `rapitas/home_screen` を使う本物の窓口（iOS のみ）
class MethodChannelHomeScreenBridge implements HomeScreenBridge {
  static const MethodChannel _channel = MethodChannel('rapitas/home_screen');

  const MethodChannelHomeScreenBridge();

  @override
  bool get isSupported => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  @override
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot) async {
    if (!isSupported) return;
    try {
      await _channel.invokeMethod<void>('writeWidgetSnapshot', jsonEncode(snapshot));
    } on MissingPluginException {
      // 古いネイティブ側（チャンネル未登録）でもアプリは動かす
    } on PlatformException {
      // ウィジェットに書けなくてもアプリの動作には関係しない
    }
  }

  @override
  Future<List<PendingRapiRequest>> peekPendingRequests() async {
    if (!isSupported) return const [];
    try {
      final raw = await _channel.invokeMethod<List<Object?>>('peekPendingRequests');
      return [
        for (final item in raw ?? const <Object?>[])
          if (PendingRapiRequest.tryParse(item) case final request?) request,
      ];
    } on MissingPluginException {
      return const [];
    } on PlatformException {
      return const [];
    }
  }

  @override
  Future<void> ackPendingRequests(List<String> ids) async {
    if (!isSupported || ids.isEmpty) return;
    try {
      await _channel.invokeMethod<void>('ackPendingRequests', ids);
    } on MissingPluginException {
      // 消せなければ次の取り込みでまた読むだけ（番号で二重取り込みを防ぐ）
    } on PlatformException {
      // 同上
    }
  }
}

final homeScreenBridgeProvider =
    Provider<HomeScreenBridge>((ref) => const MethodChannelHomeScreenBridge());
