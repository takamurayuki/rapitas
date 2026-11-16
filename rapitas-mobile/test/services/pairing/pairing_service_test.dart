import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/pairing/pairing_payload.dart';
import 'package:rapitas_mobile/services/pairing/pairing_service.dart';

/// URL ごとに決めた応答を返す（届かないアドレスは接続エラー）
class _FakeAdapter implements HttpClientAdapter {
  final Map<String, ResponseBody Function(String body)> routes;
  final List<String> requested = [];
  _FakeAdapter(this.routes);

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    final url = options.uri.toString();
    requested.add(url);
    final handler = routes[url];
    if (handler == null) {
      throw DioException(requestOptions: options, type: DioExceptionType.connectionError);
    }
    return handler(options.data?.toString() ?? '');
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody json(int status, String body) =>
    ResponseBody.fromString(body, status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });

PairingPayload payload({DateTime? expiresAt}) => PairingPayload(
      desktopId: 'desk-1',
      desktopName: 'yuki-pc',
      port: 3002,
      hosts: const ['192.168.1.5', '10.0.0.8'],
      code: 'abc',
      expiresAt: expiresAt ?? DateTime(2100),
    );

PairingService serviceWith(_FakeAdapter adapter) {
  final dio = Dio(BaseOptions(validateStatus: (_) => true))..httpClientAdapter = adapter;
  return PairingService(dio: dio);
}

void main() {
  const claim = '/mobile-link/claim';

  test('届かないアドレスは飛ばし、届いたアドレスを接続先として保存する', () async {
    final adapter = _FakeAdapter({
      'http://10.0.0.8:3002$claim': (_) =>
          json(201, '{"token":"t-1","deviceId":"d","desktopId":"desk-1","desktopName":"yuki-pc"}'),
    });
    final result = await serviceWith(adapter).pair(payload(), deviceName: 'iPhone');
    expect(adapter.requested, ['http://192.168.1.5:3002$claim', 'http://10.0.0.8:3002$claim']);
    expect(result.baseUrl, 'http://10.0.0.8:3002');
    expect(result.token, 't-1');
    expect(result.desktopId, 'desk-1');
  });

  test('届いたうえで断られたら、他のアドレスは試さずに理由を伝える', () async {
    final adapter = _FakeAdapter({
      'http://192.168.1.5:3002$claim': (_) => json(401, '{"error":"pairing code invalid"}'),
      'http://10.0.0.8:3002$claim': (_) => json(201, '{"token":"never"}'),
    });
    await expectLater(
      serviceWith(adapter).pair(payload(), deviceName: 'iPhone'),
      throwsA(isA<PairingException>().having((e) => e.message, 'message', contains('使えません'))),
    );
    expect(adapter.requested, hasLength(1));
  });

  test('期限切れ・オフの理由を区別して伝える', () async {
    final expired = _FakeAdapter({
      'http://192.168.1.5:3002$claim': (_) => json(401, '{"error":"pairing code expired"}'),
    });
    await expectLater(
      serviceWith(expired).pair(payload(), deviceName: 'iPhone'),
      throwsA(isA<PairingException>().having((e) => e.message, 'message', contains('有効期限'))),
    );
    final off = _FakeAdapter({
      'http://192.168.1.5:3002$claim': (_) => json(503, '{"error":"mobile link is off"}'),
    });
    await expectLater(
      serviceWith(off).pair(payload(), deviceName: 'iPhone'),
      throwsA(isA<PairingException>().having((e) => e.message, 'message', contains('オフ'))),
    );
  });

  test('どこにも届かなければ同じ Wi-Fi かを確認するよう伝える', () async {
    await expectLater(
      serviceWith(_FakeAdapter({})).pair(payload(), deviceName: 'iPhone'),
      throwsA(isA<PairingException>().having((e) => e.message, 'message', contains('Wi-Fi'))),
    );
  });

  test('期限切れの QR は通信する前に断る', () async {
    final adapter = _FakeAdapter({});
    await expectLater(
      serviceWith(adapter).pair(payload(expiresAt: DateTime(2000)), deviceName: 'iPhone'),
      throwsA(isA<PairingException>()),
    );
    expect(adapter.requested, isEmpty);
  });
}
