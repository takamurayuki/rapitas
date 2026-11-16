import 'package:flutter_test/flutter_test.dart';

import 'package:rapitas_mobile/models/project.dart';

void main() {
  group('Project.fromJson', () {
    test('parses a backend row with a numeric id', () {
      final project = Project.fromJson(<String, dynamic>{
        'id': 7,
        'name': 'Mobile',
        'description': 'スマホアプリ',
        'color': '#22AA88',
        'createdAt': '2026-11-01T09:00:00.000Z',
        'updatedAt': '2026-11-07T09:00:00.000Z',
      });

      expect(project.id, '7');
      expect(project.name, 'Mobile');
      expect(project.description, 'スマホアプリ');
      expect(project.color, '#22AA88');
      expect(project.createdAt, DateTime.parse('2026-11-01T09:00:00.000Z'));
      expect(project.updatedAt, DateTime.parse('2026-11-07T09:00:00.000Z'));
    });

    test('still accepts a string id and missing optional fields', () {
      final project = Project.fromJson(<String, dynamic>{
        'id': '7',
        'name': 'Mobile',
        'createdAt': '2026-11-01T09:00:00.000Z',
        'updatedAt': '2026-11-07T09:00:00.000Z',
      });

      expect(project.id, '7');
      expect(project.description, isNull);
      expect(project.color, isNull);
    });
  });
}
