// 伴走の要約のモデルと、原因コードの平易な文の対応表（ラピ伴走化 第2段階-1・2）
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/companion_digest.dart';
import 'package:rapitas_mobile/utils/plain_reasons.dart';

void main() {
  test('parses the digest the backend returns', () {
    final d = CompanionDigest.fromJson({
      'decisionCount': 1,
      'items': [
        {
          'taskId': 42,
          'title': '設定画面を作る',
          'workflowStatus': 'verify_done',
          'haltReason': 'awaiting_review_decision',
          'since': {'transitions': 2, 'holds': 1, 'repairs': 1},
          'recent': [
            {'id': 9, 'kind': 'review_held', 'toStatus': 'verify_done', 'at': '2026-11-12T03:00:00Z'},
          ],
          'repairs': {'total': 3, 'topCause': 'requirements'},
          'decision': {'kind': 'review_hold', 'holdReason': 'unresolved_dispute', 'link': '/tasks/42/decide'},
          'cursor': 9,
        },
      ],
    });
    final item = d.items.single;
    expect(item.taskId, '42');
    expect((item.transitions, item.holds, item.repairs, item.questions), (2, 1, 1, 0));
    expect(item.recent.single.kind, 'review_held');
    expect((item.repairTotal, item.repairTopCause), (3, 'requirements'));
    expect(item.decision?.kind, 'review_hold');
    expect(item.decision?.holdReason, 'unresolved_dispute');
    expect(item.decision?.link, '/tasks/42/decide');
    expect(item.cursor, 9);
    expect(d.decisionCount, 1);
  });

  test('decisionKindFor follows the backend’s order', () {
    String? k(String? wf, [String? halt, String status = 'in-progress']) =>
        decisionKindFor(status: status, workflowStatus: wf, haltReason: halt);
    expect(k('plan_created'), 'approve_plan');
    expect(k('awaiting_question'), 'answer_question');
    expect(k('verify_done', 'awaiting_review_decision'), 'review_hold');
    expect(k('plan_created', 'no_progress'), 'release_halt');
    expect(k('verify_done', 'jury_result_discarded'), 'release_halt');
    expect(k('in_progress'), isNull);
    expect(k('plan_created', null, 'done'), isNull);
  });

  group('plain words for every code', () {
    test('halt reasons, including the batch-B jury_result_discarded', () {
      for (final code in [
        'budget_time_exceeded',
        'budget_cost_exceeded',
        'budget_attempts_exceeded',
        'repeat_cause_detected',
        'no_progress',
        'awaiting_review_decision',
        'jury_result_discarded',
      ]) {
        expect(haltReasonText(code), isNot(contains(code)), reason: code);
      }
      expect(haltReasonText('jury_result_discarded'), contains('完了条件が変わった'));
    });

    test('repair causes and hold reasons', () {
      for (final code in ['capability', 'infrastructure', 'requirements', 'unfounded']) {
        expect(repairCauseText(code), isNot(contains(code)), reason: code);
      }
      for (final code in ['jury_unavailable_high_risk', 'unresolved_dispute', 'ineligible_verifier']) {
        expect(holdReasonText(code), isNot(contains(code)), reason: code);
      }
    });

    test('decisions and digest events', () {
      for (final kind in ['approve_plan', 'answer_question', 'review_hold', 'release_halt']) {
        expect(decisionCopy(kind).title, isNot(contains(kind)), reason: kind);
      }
      for (final kind in ['halted', 'review_held', 'question', 'repair', 'replanned', 'plan_ready', 'decided', 'completed']) {
        expect(digestEventText(kind), isNot(contains(kind)), reason: kind);
      }
      expect(digestEventText('progress', stageLabel: '実装中'), '「実装中」に進みました');
    });

    test('an unknown code is shown with the code, not silently reworded', () {
      expect(haltReasonText('new_code'), contains('new_code'));
      expect(repairCauseText('new_code'), contains('new_code'));
      expect(holdReasonText('new_code'), contains('new_code'));
      expect(decisionCopy('new_code').ask, contains('new_code'));
    });
  });
}
