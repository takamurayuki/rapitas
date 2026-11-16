// 聞き間違いの補正辞書の保存（設計 §4・§7.1）
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/voice_learning_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  var now = DateTime(2026, 11, 11, 10);
  DateTime clock() => now;

  setUp(() {
    now = DateTime(2026, 11, 11, 10);
    SharedPreferences.setMockInitialValues({});
  });

  Future<VoiceLearningStore> fresh() async {
    final store = VoiceLearningStore(now: clock);
    await store.load();
    return store;
  }

  Future<Map<String, dynamic>> saved() async {
    final prefs = await SharedPreferences.getInstance();
    return jsonDecode(prefs.getString(VoiceLearningStore.prefsKey)!) as Map<String, dynamic>;
  }

  test('記録すると (種別, 正規化した断片) で引け、保存され、次の起動でも読める', () async {
    final store = await fresh();
    expect(await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン 画面', targetId: '1', label: 'ログイン画面の修正'),
        isTrue);
    final c = store.lookup(VoiceTargetKind.task, 'ロビン画面')!;
    expect(c.targetId, '1');
    expect(c.heard, 'ロビン画面');
    expect(c.heardText, 'ロビン 画面');
    expect(c.count, 1);
    // 種別が違えば別の対応
    expect(store.lookup(VoiceTargetKind.hypothesis, 'ロビン画面'), isNull);

    final json = await saved();
    expect(json['version'], 1);
    expect(json['targetUsage'], isEmpty, reason: '第1弾では頻度の入れ物は空のまま');
    expect(json['commandUsage'], isEmpty);

    final next = await fresh();
    expect(next.lookup(VoiceTargetKind.task, 'ロビン画面')!.label, 'ログイン画面の修正');
  });

  test('同じキーで同じ対象なら回数が増え、別の対象なら置き換わって1から数え直す', () async {
    final store = await fresh();
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: 'A');
    now = now.add(const Duration(hours: 1));
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: 'A2');
    var c = store.lookup(VoiceTargetKind.task, 'ロビン画面')!;
    expect(c.count, 2);
    expect(c.label, 'A2');
    expect(c.lastUsedAt, now);

    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '2', label: 'B');
    c = store.lookup(VoiceTargetKind.task, 'ロビン画面')!;
    expect(c.targetId, '2');
    expect(c.count, 1);
    expect(store.corrections, hasLength(1));
  });

  test('適用して成功したら回数が増え、名前がいまの名前に変わる', () async {
    final store = await fresh();
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: '古い名前');
    await store.markUsed(store.lookup(VoiceTargetKind.task, 'ロビン画面')!, label: '新しい名前');
    final c = store.lookup(VoiceTargetKind.task, 'ロビン画面')!;
    expect(c.count, 2);
    expect(c.label, '新しい名前');
  });

  test('上限200件を超えたら、最後に使われたのが古いものから消える', () async {
    final store = await fresh();
    for (var i = 0; i < VoiceLearningStore.maxCorrections + 1; i++) {
      now = DateTime(2026, 11, 1).add(Duration(minutes: i));
      await store.record(kind: VoiceTargetKind.task, heardText: 'きき$i', targetId: '$i', label: 'T$i');
    }
    expect(store.corrections, hasLength(VoiceLearningStore.maxCorrections));
    expect(store.lookup(VoiceTargetKind.task, 'きき0'), isNull, reason: '最も古いもの');
    expect(store.lookup(VoiceTargetKind.task, 'きき1'), isNotNull);
    expect(store.corrections.first.heard, 'きき200', reason: '一覧は新しい順');
  });

  test('180日より長く使われなかったものは読み込みで消える', () async {
    final store = await fresh();
    now = DateTime(2026, 1, 1);
    await store.record(kind: VoiceTargetKind.task, heardText: '古いもの', targetId: '1', label: 'A');
    now = DateTime(2026, 6, 1);
    await store.record(kind: VoiceTargetKind.task, heardText: '新しいもの', targetId: '2', label: 'B');

    now = DateTime(2026, 7, 10); // 古いものは 190日、新しいものは 39日
    final next = await fresh();
    expect(next.lookup(VoiceTargetKind.task, '古いもの'), isNull);
    expect(next.lookup(VoiceTargetKind.task, '新しいもの'), isNotNull);
    expect((await saved())['corrections'], hasLength(1), reason: '消した結果を保存し直す');
  });

  test('ID を指定して消すとその ID の対応だけが消え、全消去で空になる', () async {
    final store = await fresh();
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: 'A');
    await store.record(kind: VoiceTargetKind.task, heardText: 'ろぐいん', targetId: '1', label: 'A');
    await store.record(kind: VoiceTargetKind.task, heardText: 'しりょう', targetId: '2', label: 'B');
    await store.record(kind: VoiceTargetKind.idea, heardText: 'ロビン画面', targetId: '1', label: 'アイデア');

    await store.removeTarget(VoiceTargetKind.task, '1');
    expect(store.corrections.map((c) => (c.kind, c.heard)),
        unorderedEquals([(VoiceTargetKind.task, 'しりょう'), (VoiceTargetKind.idea, 'ロビン画面')]));

    await store.clear();
    expect(store.corrections, isEmpty);
    expect((await saved())['corrections'], isEmpty);
  });

  test('個別に消したものは元に戻せる', () async {
    final store = await fresh();
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: 'A');
    final c = store.lookup(VoiceTargetKind.task, 'ロビン画面')!;
    await store.remove(c.kind, c.heard);
    expect(store.corrections, isEmpty);
    await store.restore(c);
    expect(store.lookup(VoiceTargetKind.task, 'ロビン画面')!.count, 1);
  });

  test('正規化後2文字未満・40文字超の断片は記録しない', () async {
    final store = await fresh();
    expect(await store.record(kind: VoiceTargetKind.task, heardText: 'ろ', targetId: '1', label: 'A'), isFalse);
    expect(await store.record(kind: VoiceTargetKind.task, heardText: ' ろ 。', targetId: '1', label: 'A'), isFalse);
    expect(await store.record(kind: VoiceTargetKind.task, heardText: 'あ' * 41, targetId: '1', label: 'A'), isFalse);
    expect(store.corrections, isEmpty);
    expect(await store.record(kind: VoiceTargetKind.task, heardText: 'ろび', targetId: '1', label: 'A'), isTrue);
    expect(await store.record(kind: VoiceTargetKind.task, heardText: 'あ' * 40, targetId: '1', label: 'A'), isTrue);
  });

  test('JSON が壊れていても例外を出さず空として読み、次の保存で上書きする', () async {
    SharedPreferences.setMockInitialValues({VoiceLearningStore.prefsKey: '{壊れた'});
    final store = await fresh();
    expect(store.corrections, isEmpty);
    await store.record(kind: VoiceTargetKind.task, heardText: 'ロビン画面', targetId: '1', label: 'A');
    expect((await saved())['corrections'], hasLength(1));
  });

  test('知らない版や型の合わない項目は読まない', () async {
    SharedPreferences.setMockInitialValues({
      VoiceLearningStore.prefsKey: jsonEncode({
        'version': 1,
        'corrections': [
          {'kind': 'nope', 'heard': 'x'},
          {
            'kind': 'task',
            'heard': 'ロビン画面',
            'heardText': 'ロビン画面',
            'targetId': '1',
            'label': 'A',
            'count': 3,
            'createdAt': '2026-11-10T10:00:00.000',
            'lastUsedAt': '2026-11-10T10:00:00.000',
          },
        ],
      }),
    });
    final store = await fresh();
    expect(store.corrections, hasLength(1));
    expect(store.corrections.single.count, 3);

    SharedPreferences.setMockInitialValues({
      VoiceLearningStore.prefsKey: jsonEncode({'version': 2, 'corrections': []}),
    });
    expect((await fresh()).corrections, isEmpty);
  });
}
