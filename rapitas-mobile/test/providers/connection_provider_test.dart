import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/connection_provider.dart';
import 'package:rapitas_mobile/services/pairing/pairing_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// キーチェーンの代わり（メモリに置くだけ）
class _MemoryStorage extends FlutterSecureStorage {
  final Map<String, String> values = {};

  @override
  Future<String?> read({required String key, IOSOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, MacOsOptions? mOptions, WindowsOptions? wOptions}) async =>
      values[key];

  @override
  Future<void> write({required String key, required String? value, IOSOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, MacOsOptions? mOptions, WindowsOptions? wOptions}) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<void> delete({required String key, IOSOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, MacOsOptions? mOptions, WindowsOptions? wOptions}) async {
    values.remove(key);
  }
}

Future<ConnectionSettingsNotifier> loaded(_MemoryStorage storage) async {
  final notifier = ConnectionSettingsNotifier(secureStorage: storage);
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
  return notifier;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('ペアリング結果を保存し、再起動後（作り直し）も読める', () async {
    final storage = _MemoryStorage();
    final first = await loaded(storage);
    await first.savePairing(const PairingResult(
      baseUrl: 'http://192.168.1.5:3002',
      token: 't-1',
      desktopId: 'desk-1',
      desktopName: 'yuki-pc',
    ));
    expect(first.state.isPaired, isTrue);
    expect(storage.values.values, contains('t-1'));

    final again = await loaded(storage);
    expect(again.state.baseUrl, 'http://192.168.1.5:3002');
    expect(again.state.apiToken, 't-1');
    expect(again.state.desktopId, 'desk-1');
    expect(again.state.desktopName, 'yuki-pc');
  });

  test('見つけ直した接続先に切り替えても、トークンとペアリング相手は残る', () async {
    final notifier = await loaded(_MemoryStorage());
    await notifier.savePairing(const PairingResult(
      baseUrl: 'http://192.168.1.5:3002',
      token: 't-1',
      desktopId: 'desk-1',
      desktopName: 'yuki-pc',
    ));
    await notifier.updateDiscoveredUrl('http://192.168.1.20:3002');
    expect(notifier.state.baseUrl, 'http://192.168.1.20:3002');
    expect(notifier.state.apiToken, 't-1');
    expect(notifier.state.desktopId, 'desk-1');
  });

  test('手入力で接続先を変えると、ペアリング相手の情報は消える', () async {
    final notifier = await loaded(_MemoryStorage());
    await notifier.savePairing(const PairingResult(
      baseUrl: 'http://192.168.1.5:3002',
      token: 't-1',
      desktopId: 'desk-1',
      desktopName: 'yuki-pc',
    ));
    await notifier.save(baseUrl: 'http://100.64.0.1:3001');
    expect(notifier.state.isPaired, isFalse);
    expect(notifier.state.apiToken, 't-1');
  });
}
