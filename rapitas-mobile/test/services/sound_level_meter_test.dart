import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/sound_level_meter.dart';

void main() {
  group('SoundLevelMeter', () {
    test('届いた値の範囲の中の位置を 0〜1 で返す（端末ごとの尺度の違いを吸収する）', () {
      // Android の RMS dB 風（-2〜10）
      final android = SoundLevelMeter();
      for (final v in [-2.0, 10.0, -2.0, 10.0]) {
        android.add(v);
      }
      android.add(8);
      final loudA = android.level.value!;
      android.add(0);
      final quietA = android.level.value!;
      expect(loudA, greaterThan(quietA));

      // まったく違う尺度（-50〜0）でも同じように振れる
      final ios = SoundLevelMeter();
      for (final v in [-50.0, 0.0, -50.0, 0.0]) {
        ios.add(v);
      }
      ios.add(-8);
      final loudI = ios.level.value!;
      ios.add(-45);
      expect(loudI, greaterThan(ios.level.value!));
      for (final v in [loudA, quietA, loudI]) {
        expect(v, inInclusiveRange(0, 1));
      }
    });

    test('静かな場所のわずかな揺れは大きく振らない（最小の幅）', () {
      final meter = SoundLevelMeter(minSpan: 4);
      meter.add(1.0);
      meter.add(1.5);
      expect(meter.level.value!, lessThan(0.5));
    });

    test('聞き取りが終わったら値を消す。おかしな値は無視する', () {
      final meter = SoundLevelMeter();
      expect(meter.level.value, isNull, reason: '音量が届かない端末では null のまま');
      meter.add(double.nan);
      expect(meter.level.value, isNull);
      meter.add(3);
      expect(meter.level.value, isNotNull);
      meter.clear();
      expect(meter.level.value, isNull);
    });
  });
}
