import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/pairing_provider.dart';
import 'package:rapitas_mobile/services/pairing/desktop_discovery.dart';

void main() {
  group('pickDesktopBaseUrl', () {
    test('ペアリングしたデスクトップだけを選び、IPv4 を優先する', () {
      final url = pickDesktopBaseUrl(const [
        DiscoveredDesktop(desktopId: 'someone-else', addresses: ['192.168.1.9'], port: 3002),
        DiscoveredDesktop(desktopId: 'mine', addresses: ['fe80::1', '192.168.1.20'], port: 3002),
      ], 'mine');
      expect(url, 'http://192.168.1.20:3002');
    });

    test('IPv6 しかなければ角括弧で囲んで使う', () {
      final url = pickDesktopBaseUrl(const [
        DiscoveredDesktop(desktopId: 'mine', addresses: ['fd00::5'], port: 3002),
      ], 'mine');
      expect(url, 'http://[fd00::5]:3002');
    });

    test('見つからない・アドレスが無いときは null', () {
      expect(pickDesktopBaseUrl(const [], 'mine'), isNull);
      expect(
        pickDesktopBaseUrl(const [DiscoveredDesktop(desktopId: 'mine', addresses: [], port: 3002)], 'mine'),
        isNull,
      );
    });
  });

  test('探し直しは1分に1回まで', () {
    var now = DateTime(2026, 11, 7, 10);
    final throttle = RelocateThrottle(now: () => now);
    expect(throttle.tryAcquire(), isTrue);
    now = now.add(const Duration(seconds: 30));
    expect(throttle.tryAcquire(), isFalse);
    now = now.add(const Duration(seconds: 31));
    expect(throttle.tryAcquire(), isTrue);
  });
}
