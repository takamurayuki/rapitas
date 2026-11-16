import 'dart:async';
import 'package:bonsoir/bonsoir.dart';
import 'pairing_payload.dart';

/// LAN 上で見つかった Rapitas デスクトップ
class DiscoveredDesktop {
  final String desktopId;
  final List<String> addresses;
  final int port;

  const DiscoveredDesktop({required this.desktopId, required this.addresses, required this.port});
}

/// ペアリング済みのデスクトップを LAN 上で探し直す（IP アドレスが変わったとき用）。
abstract class DesktopDiscovery {
  /// mDNS のサービス種別。デスクトップ側 mdns-advertiser.ts の `rapitas` と対応する
  static const serviceType = '_rapitas._tcp';

  /// [desktopId] のデスクトップを探し、見つかれば接続先 URL を返す。
  Future<String?> findBaseUrl(String desktopId, {Duration timeout = const Duration(seconds: 5)});
}

/// 見つかったデスクトップの中から、ペアリングした相手の接続先を選ぶ。
///
/// 同じネットワークに他人の Rapitas があっても、デスクトップIDが違えば選ばない。
/// IPv4 を優先する（IPv6 のリンクローカルはそのままでは URL に使えないことがあるため）。
///
/// @param found - 見つかったデスクトップ / 発見結果
/// @param desktopId - ペアリングしたデスクトップのID / 探す相手
/// @returns 接続先 URL（見つからなければ null） / 接続先
String? pickDesktopBaseUrl(Iterable<DiscoveredDesktop> found, String desktopId) {
  for (final desktop in found) {
    if (desktop.desktopId != desktopId || desktop.addresses.isEmpty) continue;
    final ipv4 = desktop.addresses.where((a) => !a.contains(':'));
    final address = ipv4.isNotEmpty ? ipv4.first : desktop.addresses.first;
    return 'http://${PairingPayload.formatHost(address)}:${desktop.port}';
  }
  return null;
}

/// bonsoir（iOS: NSNetService / Android: NsdManager）での実装。
class BonsoirDesktopDiscovery implements DesktopDiscovery {
  @override
  Future<String?> findBaseUrl(String desktopId, {Duration timeout = const Duration(seconds: 5)}) async {
    final discovery = BonsoirDiscovery(type: DesktopDiscovery.serviceType);
    final completer = Completer<String?>();
    final found = <DiscoveredDesktop>[];
    StreamSubscription<BonsoirDiscoveryEvent>? subscription;
    Timer? timer;

    try {
      await discovery.initialize();
      subscription = discovery.eventStream?.listen((event) {
        switch (event) {
          case BonsoirDiscoveryServiceFoundEvent():
            // TXT の id が一致するものだけ名前解決する（他人の Rapitas は解決しない）
            if (event.service.attributes['id'] == desktopId) {
              event.service.resolve(discovery.serviceResolver);
            }
          case BonsoirDiscoveryServiceResolvedEvent():
            found.add(DiscoveredDesktop(
              desktopId: event.service.attributes['id'] ?? '',
              addresses: event.service.hostAddresses,
              port: event.service.port,
            ));
            final url = pickDesktopBaseUrl(found, desktopId);
            if (url != null && !completer.isCompleted) completer.complete(url);
          default:
            break;
        }
      });
      await discovery.start();
      timer = Timer(timeout, () {
        if (!completer.isCompleted) completer.complete(null);
      });
      return await completer.future;
    } catch (_) {
      // マルチキャストが使えない環境（ゲストWi-Fiなど）。保存済みの接続先のまま続ける
      return null;
    } finally {
      timer?.cancel();
      await subscription?.cancel();
      try {
        if (discovery.isReady && !discovery.isStopped) await discovery.stop();
      } catch (_) {
        // 止める前に初期化で失敗していた場合など。後片付けの失敗は無視してよい
      }
    }
  }
}
