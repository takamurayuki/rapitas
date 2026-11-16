import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/pairing/pairing_payload.dart';

/// デスクトップ（pairing-payload.ts の encodePairingUri）と同じ方法で URI を作る
String encode(Map<String, dynamic> payload) =>
    PairingPayload.uriPrefix + base64Url.encode(utf8.encode(jsonEncode(payload))).replaceAll('=', '');

Map<String, dynamic> valid({int exp = 1893456000000}) => {
      'v': 1,
      'id': 'desk-1',
      'name': 'yuki-pc',
      'port': 3002,
      'hosts': ['192.168.1.5', '10.0.0.8'],
      'code': 'abc',
      'exp': exp,
    };

void main() {
  group('PairingPayload.parse', () {
    test('デスクトップが作る URI（パディングなし base64url）を読める', () {
      final payload = PairingPayload.parse(encode(valid()));
      expect(payload.desktopId, 'desk-1');
      expect(payload.desktopName, 'yuki-pc');
      expect(payload.code, 'abc');
      expect(payload.candidateBaseUrls, ['http://192.168.1.5:3002', 'http://10.0.0.8:3002']);
    });

    test('Rapitas 以外の QR、壊れた中身、未対応の版は FormatException', () {
      expect(() => PairingPayload.parse('https://example.com'), throwsFormatException);
      expect(() => PairingPayload.parse('${PairingPayload.uriPrefix}%%%'), throwsFormatException);
      expect(() => PairingPayload.parse(encode({...valid(), 'v': 2})), throwsFormatException);
      expect(() => PairingPayload.parse(encode({...valid(), 'code': null})), throwsFormatException);
    });

    test('期限切れを判定できる', () {
      final payload = PairingPayload.parse(encode(valid(exp: 1000)));
      expect(payload.isExpired(DateTime.fromMillisecondsSinceEpoch(999)), isFalse);
      expect(payload.isExpired(DateTime.fromMillisecondsSinceEpoch(1001)), isTrue);
    });

    test('IPv6 アドレスは URL 用に角括弧で囲む', () {
      expect(PairingPayload.formatHost('fe80::1'), '[fe80::1]');
      expect(PairingPayload.formatHost('192.168.1.5'), '192.168.1.5');
    });
  });
}
