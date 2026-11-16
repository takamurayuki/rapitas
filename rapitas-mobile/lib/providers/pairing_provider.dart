import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/pairing/desktop_discovery.dart';
import '../services/pairing/pairing_service.dart';
import '../services/sse_service.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

final pairingServiceProvider = Provider<PairingService>((ref) => PairingService());

final desktopDiscoveryProvider = Provider<DesktopDiscovery>((ref) => BonsoirDesktopDiscovery());

/// 探し直しを、短い間隔で何度も走らせないための見張り役。
class RelocateThrottle {
  final Duration cooldown;
  final DateTime Function() _now;
  DateTime? _last;

  RelocateThrottle({this.cooldown = const Duration(minutes: 1), DateTime Function()? now})
      : _now = now ?? DateTime.now;

  /// 今探してよいか。よければ実行したものとして記録する。
  bool tryAcquire() {
    final now = _now();
    if (_last != null && now.difference(_last!) < cooldown) return false;
    _last = now;
    return true;
  }
}

/// ペアリングしたデスクトップの IP が変わっても繋がり続けるよう、
/// 起動時とリアルタイム接続が切れたときに LAN 上で探し直し、見つかれば接続先を更新する。
/// app.dart で watch して常駐させる。
final desktopRelocatorProvider = Provider<void>((ref) {
  final throttle = RelocateThrottle();

  Future<void> relocate() async {
    final settings = ref.read(connectionSettingsProvider);
    if (!settings.loaded || !settings.isPaired) return;
    if (!throttle.tryAcquire()) return;
    final url = await ref.read(desktopDiscoveryProvider).findBaseUrl(settings.desktopId!);
    if (url != null) {
      await ref.read(connectionSettingsProvider.notifier).updateDiscoveredUrl(url);
    }
  }

  ref.listen<bool>(
    connectionSettingsProvider.select((s) => s.loaded && s.isPaired),
    (previous, ready) {
      if (ready && previous != true) relocate();
    },
    fireImmediately: true,
  );

  ref.listen<AsyncValue<SseConnectionState>>(sseConnectionStateProvider, (previous, next) {
    if (next.valueOrNull == SseConnectionState.reconnecting) relocate();
  });
});
