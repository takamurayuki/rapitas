import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_decode.dart';
import 'package:rapitas_mobile/models/rapi_chat/rapi_snapshot_encode.dart';
import 'package:rapitas_mobile/models/rapi_chat/saved_message.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';

// 完了条件の変更カード（criteria）のスナップショット（nav42 バッチB の rebase 移植）：
// 書き込みの済んだ段階だけを保存して往復し、応答待ちの記録は結果を断定しない段階で戻す。
// 直している途中のカードは保存しない。

RapiMessage _roundTrip(RapiMessage m) {
  final saved = encodeRapiMessage(m, clientId: 'c1', createdAt: DateTime.utc(2026, 11, 12))!;
  final parsed = SavedMessage.tryParse(jsonDecode(jsonEncode(saved.toJson())))!;
  return decodeSavedMessage(parsed, id: 7);
}

const _base = ['ログインできる', 'エラーが出る', '画面が崩れない'];

const _result = RapiCriteriaChangeResult(
  actionId: 31,
  before: _base,
  after: ['ログインできる', 'エラー文が日本語で出る', '2段階認証で入れる'],
);

/// 言い換え1つ（エラーが出る → エラー文が日本語で出る）・外す1つ・足す1つまで直したカード
RapiCriteriaCard _card(RapiCriteriaPhase phase, {RapiCriteriaChangeResult? result = _result}) {
  final start = RapiCriteriaCard.start(taskId: '7', title: 'ログインのバグを直す', criteria: _base);
  final edit = start.edit.rewritten(1, 'エラー文が日本語で出る').toggled(2).appended('2段階認証で入れる').settled();
  return start.copyWith(edit: edit, reason: '仕様が決まった', phase: phase, result: result);
}

RapiMessage _message(RapiCriteriaCard card) =>
    RapiMessage(id: 1, role: RapiRole.assistant, criteria: card);

void main() {
  test('確定後のカードは段階・結果・理由・言い換えの対ごと往復し、記録（archived）になる', () {
    final original = _card(RapiCriteriaPhase.applied);
    final m = _roundTrip(_message(original));
    final c = m.criteria!;
    expect(m.archived, isTrue);
    expect(m.unsupported, isFalse);
    expect(c.phase, RapiCriteriaPhase.applied);
    expect(c.taskId, '7');
    expect(c.title, 'ログインのバグを直す');
    expect(c.reason, '仕様が決まった');
    expect(c.result!.actionId, 31);
    expect(c.result!.after, _result.after);
    expect(c.error, isNull);
    // 差分の行は、言い換えを「前 → 後」の1行にまとめたまま戻る
    expect(c.rows, original.rows);
    expect(c.rows.first,
        const RapiCriteriaDiffRow(RapiCriteriaDiffKind.reworded, before: 'エラーが出る', after: 'エラー文が日本語で出る'));
  });

  test('済んだ段階（reverted・applyUnknown・revertUnavailable）はそのまま往復する', () {
    for (final phase in [
      RapiCriteriaPhase.reverted,
      RapiCriteriaPhase.applyUnknown,
      RapiCriteriaPhase.revertUnavailable,
    ]) {
      final m = _roundTrip(_message(_card(phase, result: phase == RapiCriteriaPhase.applyUnknown ? null : _result)));
      expect(m.criteria!.phase, phase, reason: phase.name);
      expect(m.archived, isTrue);
    }
  });

  test('取り消しが断られた確定後のカードは、断られた理由と案内を残す', () {
    final card = _card(RapiCriteriaPhase.applied)
        .copyWith(refusal: 'criteria_changed_since', error: 'その後に完了条件が変わったため、元に戻しませんでした。');
    final c = _roundTrip(_message(card)).criteria!;
    expect(c.refusal, 'criteria_changed_since');
    expect(c.error, 'その後に完了条件が変わったため、元に戻しませんでした。');
    expect(c.canRevert, isFalse);
  });

  test('確定の応答待ち（applying）で残った記録は applyUnknown で戻す（成功・失敗を断定しない）', () {
    final c = _roundTrip(_message(_card(RapiCriteriaPhase.applying, result: null))).criteria!;
    expect(c.phase, RapiCriteriaPhase.applyUnknown);
  });

  test('取り消しの応答待ち（reverting）で残った記録は、確定後に戻して「元に戻せたかは分からない」と添える', () {
    final c = _roundTrip(_message(_card(RapiCriteriaPhase.reverting))).criteria!;
    expect(c.phase, RapiCriteriaPhase.applied);
    expect(c.result!.actionId, 31);
    expect(c.error, rapiCriteriaRevertUnknownText);
  });

  test('直している途中（editing・drafting・proposed）のカードは保存しない', () {
    for (final phase in [RapiCriteriaPhase.editing, RapiCriteriaPhase.drafting, RapiCriteriaPhase.proposed]) {
      final m = _message(_card(phase, result: null));
      expect(rapiCriteriaSaved(phase), isFalse, reason: phase.name);
      expect(rapiShouldSave(m), isFalse, reason: phase.name);
      expect(encodeRapiMessage(m, clientId: 'c1'), isNull, reason: phase.name);
    }
    for (final phase in RapiCriteriaPhase.values) {
      final saved = rapiCriteriaSaved(phase);
      expect(saved, !{RapiCriteriaPhase.editing, RapiCriteriaPhase.drafting, RapiCriteriaPhase.proposed}.contains(phase),
          reason: phase.name);
    }
  });

  test('途中の段階で保存された形（古い・壊れた記録）は、例外にせず本文だけで unsupported になる', () {
    final m = decodeSavedMessage(
      const SavedMessage(
        clientId: 'x',
        role: 'assistant',
        kind: 'criteria',
        text: '',
        payload: '{"v":1,"kind":"criteria","criteria":{"taskId":"7","title":"t","phase":"proposed"}}',
      ),
      id: 3,
    );
    expect(m.unsupported, isTrue);
    expect(m.criteria, isNull);
  });

  test('確定・取り消しの応答待ちは処理中（切り替えを待たせ、保存をすぐ送る）', () {
    for (final phase in RapiCriteriaPhase.values) {
      final busy = rapiCardBusy(_message(_card(phase)));
      expect(busy, phase == RapiCriteriaPhase.applying || phase == RapiCriteriaPhase.reverting,
          reason: phase.name);
    }
  });
}
