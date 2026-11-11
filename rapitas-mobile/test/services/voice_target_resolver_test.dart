// 対象の名前の当て方・近さ（設計 §1.4・§3.2・§7.2）
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/voice_target_resolver.dart';

typedef _Item = ({String id, String name});

void main() {
  String label(_Item i) => i.name;
  String id(_Item i) => i.id;

  final items = <_Item>[
    (id: '1', name: 'ログイン画面の修正'),
    (id: '2', name: '資料作成'),
    (id: '3', name: 'ログイン画面のテスト'),
    (id: '4', name: '請求書の送付'),
  ];

  test('正規化：空白・句読点・括弧を落とし、全角英数字を半角・小文字にする（カナはそのまま）', () {
    expect(VoiceTargetResolver.norm('「ＡＰＩ の 追加」。'), 'apiの追加');
    expect(VoiceTargetResolver.norm('ロビン　画面'), 'ロビン画面');
  });

  test('部分一致は画面順で返る', () {
    expect(VoiceTargetResolver.matching(items, 'ログイン画面', label).map(id), ['1', '3']);
    expect(VoiceTargetResolver.matching(items, '資料', label).map(id), ['2']);
    expect(VoiceTargetResolver.matching(items, 'ロビン画面', label), isEmpty);
    expect(VoiceTargetResolver.matching(items, '　', label), isEmpty);
  });

  test('Dice 係数：同じ文字列は1、共通のバイグラムが無ければ0', () {
    expect(VoiceTargetResolver.dice('ログイン', 'ログイン'), 1);
    expect(VoiceTargetResolver.dice('ログイン', 'しりょう'), 0);
    // ロビン画面（4）とログイン画面の修正（8）で「ン画」「画面」の2つが共通 → 4/12
    expect(VoiceTargetResolver.dice('ロビン画面', 'ログイン画面の修正'), closeTo(1 / 3, 1e-9));
  });

  test('近い候補：閾値未満は除き、近い順、同点は画面順', () {
    final near = VoiceTargetResolver.nearest(items, 'ロビン画面', label);
    // 1 と 3 は同点（どちらも「ン画」「画面」が共通）。資料作成・請求書の送付は 0
    expect(near.map(id), ['1', '3']);
    expect(VoiceTargetResolver.nearest(items, 'まったく別', label), isEmpty);
  });

  test('近い候補は最大5件', () {
    final many = [for (var i = 0; i < 8; i++) (id: '$i', name: 'ログイン画面$i')];
    final near = VoiceTargetResolver.nearest(many, 'ログイン', label);
    expect(near, hasLength(VoiceTargetResolver.maxNear));
    expect(near.map(id), ['0', '1', '2', '3', '4'], reason: '同点は画面順');
  });

  test('学習した ID はいまの一覧にあるときだけ引ける', () {
    expect(VoiceTargetResolver.byId(items, '3', id)?.name, 'ログイン画面のテスト');
    expect(VoiceTargetResolver.byId(items, '99', id), isNull);
  });
}
