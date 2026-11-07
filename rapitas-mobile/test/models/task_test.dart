import 'package:flutter_test/flutter_test.dart';

import 'package:rapitas_mobile/models/task.dart';

/// Shape of a row returned by GET /tasks (Prisma row with includes):
/// numeric IDs, `labels` as a JSON-array string, nested `theme` with a
/// numeric id, plus `project` / `milestone` / `taskLabels` that the model
/// does not map.
Map<String, dynamic> _backendTaskRow() {
  return <String, dynamic>{
    'id': 545,
    'title': 'モバイル版のモデル修正',
    'description': 'ID型の不一致を直す',
    'status': 'in-progress',
    'priority': 'high',
    'labels': '["bug","mobile"]',
    'estimatedHours': 2,
    'actualHours': 1.5,
    'dueDate': '2026-11-10T00:00:00.000Z',
    'subject': null,
    'startedAt': '2026-11-07T01:00:00.000Z',
    'completedAt': null,
    'parentId': null,
    'themeId': 3,
    'projectId': 7,
    'milestoneId': 12,
    'examGoalId': null,
    'isDeveloperMode': true,
    'isAiTaskAnalysis': false,
    'agentGenerated': false,
    'agentExecutable': true,
    'autoExecutable': false,
    'requireApproval': 'always',
    'executionInstructions': null,
    'githubIssueId': 123,
    'githubPrId': null,
    'createdAt': '2026-11-01T09:00:00.000Z',
    'updatedAt': '2026-11-07T09:00:00.000Z',
    'theme': <String, dynamic>{
      'id': 3,
      'name': 'rapitas',
      'color': '#3366FF',
    },
    'project': <String, dynamic>{'id': 7, 'name': 'Mobile'},
    'milestone': <String, dynamic>{'id': 12, 'name': 'v1'},
    'taskLabels': <dynamic>[],
    'subtasks': <dynamic>[
      <String, dynamic>{
        'id': 546,
        'title': 'task.dart を直す',
        'status': 'todo',
        'priority': 'medium',
        'labels': '[]',
        'parentId': 545,
        'themeId': 3,
        'createdAt': '2026-11-02T09:00:00.000Z',
        'updatedAt': '2026-11-02T09:00:00.000Z',
      },
    ],
  };
}

void main() {
  group('Task.fromJson', () {
    test('parses a backend row with numeric IDs', () {
      final task = Task.fromJson(_backendTaskRow());

      expect(task.id, '545');
      expect(task.title, 'モバイル版のモデル修正');
      expect(task.status, 'in-progress');
      expect(task.priority, 'high');
      expect(task.estimatedHours, 2.0);
      expect(task.actualHours, 1.5);
      expect(task.parentId, isNull);
      expect(task.themeId, '3');
      expect(task.projectId, '7');
      expect(task.milestoneId, '12');
      expect(task.examGoalId, isNull);
      expect(task.githubIssueId, '123');
      expect(task.githubPrId, isNull);
      expect(task.isDeveloperMode, isTrue);
      expect(task.agentExecutable, isTrue);
      expect(task.requireApproval, 'always');
      expect(task.dueDate, DateTime.parse('2026-11-10T00:00:00.000Z'));
    });

    test('decodes labels stored as a JSON string', () {
      final task = Task.fromJson(_backendTaskRow());

      expect(task.labels, ['bug', 'mobile']);
    });

    test('parses nested theme with a numeric id', () {
      final task = Task.fromJson(_backendTaskRow());

      expect(task.theme, isNotNull);
      expect(task.theme!.id, '3');
      expect(task.theme!.name, 'rapitas');
      expect(task.theme!.color, '#3366FF');
    });

    test('parses subtasks with numeric IDs and default values', () {
      final task = Task.fromJson(_backendTaskRow());

      expect(task.subtasks, hasLength(1));
      final subtask = task.subtasks!.first;
      expect(subtask.id, '546');
      expect(subtask.parentId, '545');
      expect(subtask.themeId, '3');
      expect(subtask.labels, isEmpty);
      expect(subtask.isDeveloperMode, isFalse);
      expect(subtask.requireApproval, 'never');
      expect(subtask.theme, isNull);
      expect(subtask.subtasks, isNull);
    });

    test('still accepts string IDs and list labels', () {
      final json = _backendTaskRow()
        ..['id'] = '545'
        ..['themeId'] = '3'
        ..['githubIssueId'] = '123'
        ..['labels'] = <dynamic>['bug'];

      final task = Task.fromJson(json);

      expect(task.id, '545');
      expect(task.themeId, '3');
      expect(task.githubIssueId, '123');
      expect(task.labels, ['bug']);
    });

    test('falls back to an empty list for empty or invalid labels', () {
      final empty = Task.fromJson(_backendTaskRow()..['labels'] = '');
      final invalid = Task.fromJson(_backendTaskRow()..['labels'] = 'not json');
      final notArray = Task.fromJson(_backendTaskRow()..['labels'] = '{}');

      expect(empty.labels, isEmpty);
      expect(invalid.labels, isEmpty);
      expect(notArray.labels, isEmpty);
    });

    test('keeps null labels as null', () {
      final task = Task.fromJson(_backendTaskRow()..['labels'] = null);

      expect(task.labels, isNull);
    });
  });

  group('Task.toJson', () {
    test('writes numeric ID strings back as int', () {
      final json = Task.fromJson(_backendTaskRow()).toJson();

      expect(json['id'], 545);
      expect(json['themeId'], 3);
      expect(json['projectId'], 7);
      expect(json['milestoneId'], 12);
      expect(json['githubIssueId'], 123);
      expect((json['theme'] as Map<String, dynamic>)['id'], 3);
      final subtasks = json['subtasks'] as List<dynamic>;
      expect((subtasks.first as Map<String, dynamic>)['parentId'], 545);
    });

    test('omits null ID fields', () {
      final json = Task.fromJson(_backendTaskRow()).toJson();

      expect(json.containsKey('parentId'), isFalse);
      expect(json.containsKey('examGoalId'), isFalse);
      expect(json.containsKey('githubPrId'), isFalse);
    });

    test('round-trips through fromJson', () {
      final original = Task.fromJson(_backendTaskRow());
      final restored = Task.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.themeId, original.themeId);
      expect(restored.parentId, original.parentId);
      expect(restored.labels, original.labels);
      expect(restored.theme!.id, original.theme!.id);
      expect(restored.subtasks!.first.parentId, '545');
    });
  });
}
