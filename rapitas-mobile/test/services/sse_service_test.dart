import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/sse_service.dart';

/// 揺らぎを0にして待ち時間を確定させる
class _NoJitter implements Random {
  @override
  double nextDouble() => 0;
  @override
  bool nextBool() => false;
  @override
  int nextInt(int max) => 0;
}

void main() {
  group('SseService.backoffFor', () {
    test('1秒から倍々に伸び、30秒で頭打ちになる', () {
      final waits = [for (var i = 0; i < 8; i++) SseService.backoffFor(i, random: _NoJitter()).inSeconds];
      expect(waits, [1, 2, 4, 8, 16, 30, 30, 30]);
    });

    test('揺らぎを足しても30秒を超えない', () {
      final max = SseService.backoffFor(10, random: Random(1));
      expect(max.inMilliseconds, lessThanOrEqualTo(30000));
    });
  });

  group('SseService.isUnauthorized', () {
    DioException withStatus(int status) {
      final options = RequestOptions(path: '/events/stream');
      return DioException(
        requestOptions: options,
        response: Response(requestOptions: options, statusCode: status),
        type: DioExceptionType.badResponse,
      );
    }

    test('401 と 403 は再接続しても直らない失敗として扱う', () {
      expect(SseService.isUnauthorized(withStatus(401)), isTrue);
      expect(SseService.isUnauthorized(withStatus(403)), isTrue);
    });

    test('サーバーエラーや通信断は再接続の対象', () {
      expect(SseService.isUnauthorized(withStatus(503)), isFalse);
      expect(SseService.isUnauthorized(null), isFalse);
      expect(
        SseService.isUnauthorized(DioException(
          requestOptions: RequestOptions(path: '/'),
          type: DioExceptionType.connectionError,
        )),
        isFalse,
      );
    });
  });
}
