import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/widgets/rapi_avatar.dart';

// ラピの瞬き（デスクトップ RapiAvatar.tsx：dur 4.5s、keyTimes 0;0.92;0.96;1、ry 5.8;5.8;0.6;5.8）。
// 撮るとき：RAPI_SCREENSHOT_DIR=<出力先> flutter test test/widgets/rapi_avatar_test.dart
// （開いた目・閉じた目のアバター単体を PNG で書き出す。指定がなければ撮らない）

const _closedRatio = 0.6 / 5.8;

double _ratio(WidgetTester tester) {
  final paint = tester.widget<CustomPaint>(
    find.descendant(of: find.byType(RapiAvatar), matching: find.byType(CustomPaint)).last,
  );
  return (paint.painter! as RapiEyesPainter).ryRatio;
}

Widget _host({bool disableAnimations = false, GlobalKey? boundary}) {
  return MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: RepaintBoundary(
          key: boundary,
          child: Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 30),
            child: const RapiAvatar(size: 120),
          ),
        ),
      ),
    ),
  );
}

/// 周期の頭から [ms] ミリ秒進める（開いている間のタイマー → 瞬きの動き、の順に進む）
Future<void> _advanceTo(WidgetTester tester, int ms) async {
  const hold = 4140;
  if (ms <= hold) {
    await tester.pump(Duration(milliseconds: ms));
    return;
  }
  await tester.pump(const Duration(milliseconds: hold));
  await tester.pump(Duration(milliseconds: ms - hold));
}

void main() {
  group('瞬きの値（デスクトップの keyTimes / values と一致）', () {
    test('0〜92% は開いたまま、96% でいちばん細く、100% で戻る', () {
      expect(rapiBlinkRyRatio(0), 1);
      expect(rapiBlinkRyRatio(0.5), 1);
      expect(rapiBlinkRyRatio(0.92), 1);
      expect(rapiBlinkRyRatio(0.94), closeTo((1 + _closedRatio) / 2, 1e-9));
      expect(rapiBlinkRyRatio(0.96), closeTo(_closedRatio, 1e-9));
      expect(rapiBlinkRyRatio(0.98), closeTo((1 + _closedRatio) / 2, 1e-9));
      expect(rapiBlinkRyRatio(1), 1);
      expect(rapiBlinkCycle, const Duration(milliseconds: 4500));
    });
  });

  testWidgets('表示直後は開いていて、4.14 秒まで開いたまま', (tester) async {
    await tester.pumpWidget(_host());
    expect(_ratio(tester), 1);
    await tester.pump(const Duration(milliseconds: 4000));
    expect(_ratio(tester), 1);
  });

  testWidgets('周期の 94〜96% で目がほぼ閉じ、1 周期を過ぎると再び開く', (tester) async {
    await tester.pumpWidget(_host());
    await _advanceTo(tester, 4230); // 94%
    expect(_ratio(tester), closeTo((1 + _closedRatio) / 2, 0.02));
    await tester.pump(const Duration(milliseconds: 90)); // 96%
    expect(_ratio(tester), closeTo(_closedRatio, 0.02));
    await tester.pump(const Duration(milliseconds: 300)); // 4.62 秒 = 次の周期の頭
    expect(_ratio(tester), 1);

    // 次の周期も同じ時刻に瞬く
    await tester.pump(const Duration(milliseconds: 4020)); // 次の周期の 4.14 秒
    await tester.pump(const Duration(milliseconds: 180));
    expect(_ratio(tester), closeTo(_closedRatio, 0.02));
    await tester.pumpAndSettle();
    expect(_ratio(tester), 1);
  });

  testWidgets('開いている間はフレームを要求しない（pumpAndSettle が終わる）', (tester) async {
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('disableAnimations のときは時間が進んでも開いたまま', (tester) async {
    await tester.pumpWidget(_host(disableAnimations: true));
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 450));
      expect(_ratio(tester), 1);
    }
  });

  testWidgets('瞬きの途中で disableAnimations になると開いた目で止まる', (tester) async {
    await tester.pumpWidget(_host());
    await _advanceTo(tester, 4320);
    expect(_ratio(tester), lessThan(0.5));
    await tester.pumpWidget(_host(disableAnimations: true));
    expect(_ratio(tester), 1);
    await tester.pump(const Duration(seconds: 10));
    expect(_ratio(tester), 1);
  });

  testWidgets('占める大きさは size の正方形のまま', (tester) async {
    await tester.pumpWidget(_host());
    expect(tester.getSize(find.byType(RapiAvatar)), const Size(120, 120));
  });

  final outDir = Platform.environment['RAPI_SCREENSHOT_DIR'];
  testWidgets('開いた目・閉じた目を撮る', (tester) async {
    final key = GlobalKey();
    Future<void> capture(String name) async {
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        File('$outDir/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    await tester.pumpWidget(_host(boundary: key));
    // SVG の読み込みは実時間で終わるのを待つ
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 500)));
    await tester.pump();
    await capture('rapi-eyes-open');
    await _advanceTo(tester, 4320); // 96% = いちばん細い
    await capture('rapi-eyes-closed');
  }, skip: outDir == null);
}
