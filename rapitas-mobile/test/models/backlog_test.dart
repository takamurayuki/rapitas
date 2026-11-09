import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';

void main() {
  group('Idea.fromJson', () {
    test('代表フィールドを読み、数値の id を文字列にする', () {
      final idea = Idea.fromJson({
        'id': 42,
        'title': 'オフライン下書き',
        'content': '電波が無くても書けるように',
        'category': 'improvement',
        'scope': 'project',
        'priority': 'high',
        'tags': <String>[],
        'themeId': 7,
        'source': 'user',
        'usedInTaskId': null,
        'createdAt': '2026-11-09T01:02:03.000Z',
      });
      expect(idea.id, '42');
      expect(idea.title, 'オフライン下書き');
      expect(idea.content, '電波が無くても書けるように');
      expect(idea.priority, 'high');
      expect(idea.scope, 'project');
      expect(idea.themeId, '7');
      expect(idea.usedInTaskId, isNull);
      expect(idea.createdAt, DateTime.utc(2026, 11, 9, 1, 2, 3));
    });

    test('欠けた項目は既定値（優先度 medium・scope global・日付 null）', () {
      final idea = Idea.fromJson({'id': '5', 'title': 'x'});
      expect(idea.id, '5');
      expect(idea.content, '');
      expect(idea.priority, 'medium');
      expect(idea.scope, 'global');
      expect(idea.themeId, isNull);
      expect(idea.createdAt, isNull);
    });
  });

  group('Concern.fromJson', () {
    test('代表フィールドを読み、数値の id を文字列にする', () {
      final concern = Concern.fromJson({
        'id': 3,
        'title': '再接続が遅い',
        'detail': 'IP 変更後に 30 秒かかる',
        'type': 'perf',
        'severity': 'urgent',
        'location': 'lib/services/sse_service.dart',
        'status': 'task_created',
        'source': 'user',
        'originTaskId': null,
        'createdTaskId': 99,
        'themeId': null,
        'createdAt': '2026-11-08T10:00:00.000Z',
        'linkedIssue': null,
      });
      expect(concern.id, '3');
      expect(concern.title, '再接続が遅い');
      expect(concern.detail, 'IP 変更後に 30 秒かかる');
      expect(concern.type, 'perf');
      expect(concern.severity, 'urgent');
      expect(concern.status, 'task_created');
      expect(concern.location, 'lib/services/sse_service.dart');
      expect(concern.themeId, isNull);
      expect(concern.createdAt, isNotNull);
    });

    test('欠けた項目は既定値（other・medium・open）', () {
      final concern = Concern.fromJson({'id': 1, 'title': 't', 'detail': 'd'});
      expect(concern.type, 'other');
      expect(concern.severity, 'medium');
      expect(concern.status, 'open');
      expect(concern.location, isNull);
    });
  });

  group('Hypothesis.fromJson', () {
    test('代表フィールド・証拠・確信度を読み、数値の id を文字列にする', () {
      final hypothesis = Hypothesis.fromJson({
        'id': 12,
        'statement': 'キャッシュを外すと初回表示が遅くなる',
        'rationale': '計測で 2 倍',
        'domain': 'performance',
        'status': 'supported',
        'confidence': 0.826,
        'evidence': [
          {
            'stance': 'for',
            'detail': '計測結果',
            'artifact': 'bench.txt',
            'taskId': 5,
            'phase': null,
            'at': '2026-11-08T00:00:00.000Z',
          },
        ],
        'themeId': 2,
        'originTaskId': 5,
        'createdAt': '2026-11-08T00:00:00.000Z',
        'updatedAt': '2026-11-08T00:00:00.000Z',
      });
      expect(hypothesis.id, '12');
      expect(hypothesis.statement, 'キャッシュを外すと初回表示が遅くなる');
      expect(hypothesis.rationale, '計測で 2 倍');
      expect(hypothesis.domain, 'performance');
      expect(hypothesis.status, 'supported');
      expect(hypothesis.confidence, closeTo(0.826, 1e-9));
      expect(hypothesis.confidencePercent, 83);
      expect(hypothesis.evidence, hasLength(1));
      expect(hypothesis.evidence.first.stance, 'for');
      expect(hypothesis.evidence.first.artifact, 'bench.txt');
      expect(hypothesis.themeId, '2');
    });

    test('整数の確信度・証拠なし・範囲外の確信度', () {
      final h = Hypothesis.fromJson({'id': 1, 'statement': 's', 'confidence': 1});
      expect(h.confidence, 1.0);
      expect(h.confidencePercent, 100);
      expect(h.evidence, isEmpty);
      expect(h.status, 'open');
      expect(Hypothesis.fromJson({'id': 2, 'confidence': 1.7}).confidencePercent, 100);
      expect(Hypothesis.fromJson({'id': 3}).confidencePercent, 0);
    });
  });

  group('作成ボディ', () {
    test('アイデア: 内容が空ならタイトルで埋め、scope は global、themeId は送らない', () {
      final body = buildIdeaCreateBody(title: '  案  ', content: '  ', priority: 'low');
      expect(body, {'title': '案', 'content': '案', 'scope': 'global', 'priority': 'low'});
      expect(body.containsKey('themeId'), isFalse);
    });

    test('懸念: 場所が空ならキーごと省き、あれば前後の空白を落とす', () {
      expect(
        buildConcernCreateBody(
            title: ' t ', detail: ' d ', type: 'bug', severity: 'high', location: ' '),
        {'title': 't', 'detail': 'd', 'type': 'bug', 'severity': 'high'},
      );
      expect(
        buildConcernCreateBody(
            title: 't', detail: 'd', type: 'bug', severity: 'high', location: ' a.dart ')['location'],
        'a.dart',
      );
    });
  });
}
