import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';

void main() {
  group('TaskDraft.fromJson', () {
    test('AI が読んだ下書きの代表フィールドを読み、数値の id を文字列にする', () {
      final draft = TaskDraft.fromJson({
        'title': 'アバターを直す',
        'description': '緊急 rapitas のアバターを直す 2時間',
        'priority': 'urgent',
        'dueDate': '2026-11-12T00:00:00.000Z',
        'estimatedHours': 2,
        'themeId': 3,
        'themeCandidates': [
          {'id': 3, 'name': 'rapitas'},
          {'id': 5, 'name': '健康'},
        ],
        'missing': <String>[],
        'reasons': {'theme': {'code': 'matchedThemeName', 'value': 'rapitas'}},
        'themeReason': '「rapitas」と書かれていたため',
        'acceptanceCriteria': ['アバターが表示される', '崩れない'],
        'unclear': ['期限の時刻'],
      }, source: 'intent');

      expect(draft.title, 'アバターを直す');
      expect(draft.description, '緊急 rapitas のアバターを直す 2時間');
      expect(draft.priority, 'urgent');
      expect(draft.dueDate, '2026-11-12T00:00:00.000Z');
      expect(draft.estimatedHours, 2.0);
      expect(draft.themeId, '3');
      expect(draft.themeCandidates.map((t) => t.id), ['3', '5']);
      expect(draft.themeCandidates.map((t) => t.name), ['rapitas', '健康']);
      expect(draft.missing, isEmpty);
      expect(draft.themeReason, '「rapitas」と書かれていたため');
      expect(draft.acceptanceCriteria, ['アバターが表示される', '崩れない']);
      expect(draft.unclear, ['期限の時刻']);
      expect(draft.source, 'intent');
      expect(draft.fellBackToPatterns, isFalse);
    });

    test('パターン推定の下書き：任意項目が欠けても読め、テーマは未確定のまま', () {
      final draft = TaskDraft.fromJson({
        'title': '牛乳を買う',
        'themeCandidates': [
          {'id': 1, 'name': '家事'},
          {'id': 2, 'name': '仕事'},
        ],
        'missing': ['theme'],
        'reasons': <String, dynamic>{},
      }, source: 'patterns');

      expect(draft.title, '牛乳を買う');
      expect(draft.description, isNull);
      expect(draft.priority, isNull);
      expect(draft.dueDate, isNull);
      expect(draft.estimatedHours, isNull);
      expect(draft.themeId, isNull);
      expect(draft.themeCandidates, hasLength(2));
      expect(draft.missing, ['theme']);
      expect(draft.themeReason, isNull);
      expect(draft.acceptanceCriteria, isEmpty);
      expect(draft.unclear, isEmpty);
      expect(draft.fellBackToPatterns, isTrue);
    });

    test('完了条件が仮の案（サーバーがタイトルから作った）かどうかを読む', () {
      final fallback = TaskDraft.fromJson({
        'title': '牛乳を買う',
        'acceptanceCriteria': ['「牛乳を買う」で求められている成果ができあがり…'],
        'acceptanceCriteriaFallback': true,
      });
      expect(fallback.acceptanceCriteria, hasLength(1));
      expect(fallback.acceptanceCriteriaFallback, isTrue);
      expect(fallback.copyWith(title: 'x').acceptanceCriteriaFallback, isTrue);
      expect(TaskDraft.fromJson({'title': 'x'}).acceptanceCriteriaFallback, isFalse);
    });

    test('themeCandidates が無い・壊れていても空配列になる', () {
      expect(TaskDraft.fromJson({'title': 'x'}).themeCandidates, isEmpty);
      expect(
        TaskDraft.fromJson({'title': 'x', 'themeCandidates': 'oops'}).themeCandidates,
        isEmpty,
      );
    });
  });

  group('AskAnswer.fromJson', () {
    test('件数と行を読む', () {
      final answer = AskAnswer.fromJson({
        'success': true,
        'available': true,
        'query': {'statuses': ['blocked']},
        'total': 25,
        'rows': [
          {
            'id': 10,
            'title': 'CI を直す',
            'status': 'blocked',
            'priority': 'high',
            'themeId': 3,
            'dueDate': '2026-11-10T00:00:00.000Z',
            'updatedAt': '2026-11-01T00:00:00.000Z',
          },
          {
            'id': 11,
            'title': '依存を上げる',
            'status': 'blocked',
            'priority': 'medium',
            'themeId': null,
            'dueDate': null,
            'updatedAt': '2026-11-02T00:00:00.000Z',
          },
        ],
        'unclear': ['どのテーマか'],
      });

      expect(answer.available, isTrue);
      expect(answer.total, 25);
      expect(answer.rows, hasLength(2));
      expect(answer.rows.first.id, '10');
      expect(answer.rows.first.title, 'CI を直す');
      expect(answer.rows.first.status, 'blocked');
      expect(answer.rows.first.priority, 'high');
      expect(answer.rows.first.dueDate, DateTime.utc(2026, 11, 10));
      expect(answer.rows[1].dueDate, isNull);
      expect(answer.unclear, ['どのテーマか']);
    });

    test('読み取れなかったときは available=false で、行も件数も無い', () {
      final answer = AskAnswer.fromJson({'success': true, 'available': false});
      expect(answer.available, isFalse);
      expect(answer.total, 0);
      expect(answer.rows, isEmpty);
      expect(answer.unclear, isEmpty);
    });
  });

  group('SupervisionSurvey.fromJson', () {
    test('分類ごとの総数とタスクを読み、手当てが要る分類だけを needing に出す', () {
      final survey = SupervisionSurvey.fromJson({
        'success': true,
        'total': 12,
        'checkedAt': '2026-11-09T00:00:00.000Z',
        'categories': [
          {'category': 'held', 'total': 0, 'tasks': <dynamic>[]},
          {
            'category': 'blocked',
            'total': 12,
            'tasks': [
              {
                'id': 7,
                'title': '承認待ちで止まっている',
                'status': 'blocked',
                'themeId': 2,
                'dueDate': null,
                'updatedAt': '2026-11-06T00:00:00.000Z',
              },
            ],
          },
        ],
      });

      expect(survey.total, 12);
      expect(survey.categories, hasLength(2));
      expect(survey.needing.map((c) => c.category), ['blocked']);

      final blocked = survey.needing.single;
      expect(blocked.total, 12);
      expect(blocked.label, 'ブロック中');
      expect(blocked.reason, isNotNull);
      final task = blocked.tasks.single;
      expect(task.id, '7');
      expect(task.title, '承認待ちで止まっている');
      expect(task.status, 'blocked');
      expect(task.themeId, '2');
      expect(task.dueDate, isNull);
      expect(task.daysWaiting(DateTime.utc(2026, 11, 9)), 3);
    });

    test('任意項目が欠けても読める（未知の分類はキーをそのまま表示）', () {
      final survey = SupervisionSurvey.fromJson({
        'total': 1,
        'categories': [
          {
            'category': 'somethingNew',
            'total': 1,
            'tasks': [
              {'id': 1, 'title': 't', 'status': 'todo'},
            ],
          },
        ],
      });
      final finding = survey.categories.single;
      expect(finding.label, 'somethingNew');
      expect(finding.reason, isNull);
      expect(finding.tasks.single.themeId, isNull);
      expect(finding.tasks.single.updatedAt, isNull);
      expect(finding.tasks.single.daysWaiting(), isNull);

      expect(SupervisionSurvey.fromJson({}).categories, isEmpty);
      expect(SupervisionSurvey.fromJson({}).total, 0);
    });
  });

  group('RoutedIntent.fromJson', () {
    test('routed=false なら intent は null', () {
      final r = RoutedIntent.fromJson({'success': true, 'routed': false});
      expect(r.routed, isFalse);
      expect(r.intent, isNull);
    });

    test('routed=true なら intent と reason を読む', () {
      final r = RoutedIntent.fromJson({
        'success': true,
        'routed': true,
        'intent': 'create',
        'reason': 'やることを書いているので',
      });
      expect(r.intent, 'create');
      expect(r.reason, 'やることを書いているので');
    });
  });

  group('RoadmapStep', () {
    test('完了条件を受け取ったまま commit に返す（列に入る）', () {
      final step = RoadmapStep.fromJson({
        'title': '経歴書',
        'description': '書く\n\n## 完了条件\n- [ ] A4 1枚',
        'acceptanceCriteria': ['A4 1枚'],
      });
      expect(step.acceptanceCriteria, ['A4 1枚']);
      expect(step.toJson()['acceptanceCriteria'], ['A4 1枚']);
    });

    test('完了条件が無い古い形は送らない（サーバーが説明文から読む）', () {
      final step = RoadmapStep.fromJson({'title': '経歴書', 'description': '書く'});
      expect(step.acceptanceCriteria, isEmpty);
      expect(step.toJson().containsKey('acceptanceCriteria'), isFalse);
    });
  });
}
