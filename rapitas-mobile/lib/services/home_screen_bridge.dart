import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// iOS のホーム画面まわり（ウィジェット・ショートカット）とのやりとり。
//
// 相手は ios/Runner/RapiHomeScreenChannel.swift（MethodChannel `rapitas/home_screen`）。
// - writeWidgetSnapshot：ウィジェットに出す値（表示用だけ。トークンや URL は入れない）を
//   App Group の共有 UserDefaults に書き、WidgetKit に描き直しを頼む
// - takePendingRequests：ショートカット「ラピに依頼」がアプリに預けた依頼を取り出して消す
//
// NOTE: iOS 以外（Android・テスト）には相手がいないので、[isSupported] が false なら何もしない。

/// ショートカットから預かった依頼1件
class PendingRapiRequest {
  final String text;
  final DateTime? createdAt;

  /// 預けた理由：needs_confirmation（アプリでの確認が要る依頼）/ offline / unauthorized /
  /// timeout / locked / unpaired（送れなかった）
  final String reason;

  const PendingRapiRequest({required this.text, this.createdAt, this.reason = 'needs_confirmation'});

  /// アプリでの確認が要るだけで、送信自体は失敗していないか
  bool get needsConfirmationOnly => reason == 'needs_confirmation';

  /// ネイティブから届いた1件を読む。本文が空なら null
  ///
  /// @param raw - {text, createdAt, reason} / MethodChannel の値
  /// @returns 依頼。読めなければ null
  static PendingRapiRequest? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final text = raw['text'];
    if (text is! String || text.trim().isEmpty) return null;
    final created = raw['createdAt'];
    final reason = raw['reason'];
    return PendingRapiRequest(
      text: text.trim(),
      createdAt: created is String ? DateTime.tryParse(created) : null,
      reason: reason is String && reason.isNotEmpty ? reason : 'needs_confirmation',
    );
  }
}

/// ホーム画面まわりのネイティブ機能の窓口（テストでは差し替える）
abstract class HomeScreenBridge {
  /// この端末でウィジェットとショートカットが使えるか
  bool get isSupported;

  /// ウィジェットのスナップショットを書き、描き直しを頼む
  ///
  /// @param snapshot - 表示用の値だけの JSON / home_widget_sync_provider.dart の buildWidgetSnapshot
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot);

  /// ショートカットが預けた依頼を古い順に取り出す（取り出した分はネイティブ側から消える）
  Future<List<PendingRapiRequest>> takePendingRequests();
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
  Future<List<PendingRapiRequest>> takePendingRequests() async {
    if (!isSupported) return const [];
    try {
      final raw = await _channel.invokeMethod<List<Object?>>('takePendingRequests');
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
}

final homeScreenBridgeProvider =
    Provider<HomeScreenBridge>((ref) => const MethodChannelHomeScreenBridge());
