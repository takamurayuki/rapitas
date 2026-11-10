import 'package:flutter/foundation.dart';

// 音声認識が返す音量を、聞き取り表示の波形の高さ（0〜1）に直す。
//
// NOTE: speech_to_text の onSoundLevelChange の値は端末で範囲が違う（Android は RMS の dB でおよそ -2〜10、
// iOS は別の尺度）。決め打ちの範囲で割ると片方の端末で振り切れるか動かないので、
// 届いた値の最小・最大を覚えて、その間の位置で表す（最小・最大はゆっくり今の値へ寄せ、環境の変化に追従する）。

class SoundLevelMeter {
  SoundLevelMeter({this.minSpan = 4, this.decay = 0.02});

  /// 最小と最大の差の下限（静かな部屋で、わずかな揺れが全振幅に見えないように）
  final double minSpan;

  /// 1回の値ごとに、最小・最大を今の値へ寄せる割合
  final double decay;

  /// 波形の高さ（0〜1）。聞き取りをしていない・音量が届かない端末では null
  final ValueNotifier<double?> level = ValueNotifier(null);

  double? _floor;
  double? _ceil;

  /// 音声認識から届いた音量を取り込む
  ///
  /// @param raw - 端末が返した音量（尺度は端末しだい） / 端末の生の音量
  void add(double raw) {
    if (raw.isNaN || raw.isInfinite) return;
    var floor = _floor ?? raw;
    var ceil = _ceil ?? raw;
    if (raw < floor) floor = raw;
    if (raw > ceil) ceil = raw;
    floor += (raw - floor) * decay;
    ceil += (raw - ceil) * decay;
    _floor = floor;
    _ceil = ceil;
    final span = (ceil - floor) < minSpan ? minSpan : ceil - floor;
    level.value = ((raw - floor) / span).clamp(0.0, 1.0);
  }

  /// 聞き取りが終わった（波形は音量なしの動きに戻す）。覚えた範囲は次の聞き取りに持ち越す
  void clear() => level.value = null;

  void dispose() => level.dispose();
}
