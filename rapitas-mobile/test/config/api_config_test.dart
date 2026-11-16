import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/api_config.dart';

void main() {
  group('ApiConfig', () {
    test('末尾のスラッシュを落とし、スキームが無ければ http を補う', () {
      expect(ApiConfig.normalizeBaseUrl('http://100.64.0.1:3001/'), 'http://100.64.0.1:3001');
      expect(ApiConfig.normalizeBaseUrl('  100.64.0.1:3001 '), 'http://100.64.0.1:3001');
      expect(ApiConfig.normalizeBaseUrl('https://pc.tailnet.ts.net'), 'https://pc.tailnet.ts.net');
    });

    test('トークンがあるときだけ Authorization ヘッダーを付ける', () {
      expect(ApiConfig(baseUrl: 'http://pc:3001').authHeaders, isEmpty);
      expect(ApiConfig(baseUrl: 'http://pc:3001', apiToken: '   ').hasToken, isFalse);
      expect(
        ApiConfig(baseUrl: 'http://pc:3001', apiToken: 'secret').authHeaders,
        {'Authorization': 'Bearer secret'},
      );
    });

    test('SSE の URL にトークンを載せない', () {
      final config = ApiConfig(baseUrl: 'http://pc:3001/', apiToken: 'secret');
      expect(config.sseUrl, 'http://pc:3001/events/stream');
    });
  });
}
