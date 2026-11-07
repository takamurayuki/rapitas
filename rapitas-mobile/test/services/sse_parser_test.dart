import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/sse_parser.dart';

void main() {
  group('SseParser', () {
    test('バックエンドの形式（id / event / data）を1件のイベントにする', () {
      final parser = SseParser();
      final events = parser.add('id: 1-abc\nevent: execution_status\ndata: {"status":"running"}\n\n');

      expect(events, hasLength(1));
      expect(events.single.type, 'execution_status');
      expect(events.single.data, '{"status":"running"}');
      expect(events.single.id, '1-abc');
      expect(parser.lastEventId, '1-abc');
    });

    test('チャンクが行の途中で切れても、つなげて解釈する', () {
      final parser = SseParser();
      expect(parser.add('event: new_noti'), isEmpty);
      expect(parser.add('fication\ndata: {"id"'), isEmpty);
      final events = parser.add(':1}\n\n');

      expect(events.single.type, 'new_notification');
      expect(events.single.data, '{"id":1}');
    });

    test('複数の data 行は改行でつなぐ', () {
      final events = SseParser().add('data: a\ndata: b\n\n');
      expect(events.single.data, 'a\nb');
      expect(events.single.type, 'message');
    });

    test('CRLF と CR 単独の改行も扱う', () {
      final parser = SseParser();
      final crlf = parser.add('event: x\r\ndata: 1\r\n\r\n');
      final cr = parser.add('event: y\rdata: 2\r\r');

      expect(crlf.single.type, 'x');
      expect(cr.single.type, 'y');
      expect(cr.single.data, '2');
    });

    test('CRLF が CR と LF の間でチャンクに分かれても、空行を作らない', () {
      final parser = SseParser();
      expect(parser.add('data: 1\r'), isEmpty);
      expect(parser.add('\ndata: 2\r\n\r\n').single.data, '1\n2');
    });

    test('コメント行と data の無いブロックはイベントにしない', () {
      final events = SseParser().add(': keep-alive\n\nevent: only-type\n\n');
      expect(events, isEmpty);
    });

    test('data の無いブロックの event 名は次のイベントに持ち越さない', () {
      final events = SseParser().add('event: stale\n\ndata: x\n\n');
      expect(events.single.type, 'message');
    });

    test('コロン直後の空白は1つだけ取り除く', () {
      final events = SseParser().add('data:  two spaces\n\n');
      expect(events.single.data, ' two spaces');
    });
  });
}
