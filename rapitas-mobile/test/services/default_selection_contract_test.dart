import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';
import 'package:rapitas_mobile/services/category_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';

// ☆（既定カテゴリ・テーマ）とアイデアのテーマ紐づけで呼ぶ API の契約
// （routes/organization/{categories,themes}.ts、routes/memory/idea-box.ts）

/// GET・PATCH を記録する ApiClient。GET は [getData] を返す
class _RecordingClient implements ApiClient {
  final List<String> getPaths = [];
  final List<({String path, dynamic data})> patches = [];
  dynamic getData;

  @override
  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters, Duration? receiveTimeout}) async {
    getPaths.add(path);
    return Response<T>(data: getData as T, statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  Future<Response<T>> patch<T>(String path, {dynamic data}) async {
    patches.add((path: path, data: data));
    return Response<T>(statusCode: 200, requestOptions: RequestOptions(path: path));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _RecordingClient client;
  setUp(() => client = _RecordingClient());

  group('isDefault の読み取り', () {
    test('テーマ・カテゴリの isDefault を読み、欠けていれば false', () {
      expect(TaskTheme.fromJson({'id': 1, 'name': 'a', 'isDefault': true}).isDefault, isTrue);
      expect(TaskTheme.fromJson({'id': 1, 'name': 'a'}).isDefault, isFalse);
      expect(TaskCategory.fromJson({'id': 1, 'name': 'c', 'isDefault': true}).isDefault, isTrue);
      expect(TaskCategory.fromJson({'id': 1, 'name': 'c', 'isDefault': 'yes'}).isDefault, isFalse);
    });
  });

  group('☆ の設定', () {
    test('テーマは PATCH /themes/:id/set-default', () async {
      await ThemeService(client).setDefaultTheme('9');
      expect(client.patches.single.path, '/themes/9/set-default');
    });

    test('カテゴリは PATCH /categories/:id/set-default、☆ は GET /categories/default-category から読む', () async {
      final service = CategoryService(client);
      await service.setDefaultCategory('4');
      expect(client.patches.single.path, '/categories/4/set-default');

      client.getData = {'defaultCategoryId': 4, 'category': {'id': 4}};
      expect(await service.getDefaultCategoryId(), '4');
      expect(client.getPaths.last, '/categories/default-category');
      client.getData = {'defaultCategoryId': null};
      expect(await service.getDefaultCategoryId(), isNull);
    });
  });

  group('アイデアのテーマ', () {
    test('作成ボディ：テーマを選んだら themeId（数値）と scope=project、選ばなければ themeId なしで global', () {
      expect(
        buildIdeaCreateBody(title: '案', priority: 'high', themeId: '12'),
        {'title': '案', 'content': '案', 'scope': 'project', 'priority': 'high', 'themeId': 12},
      );
      final none = buildIdeaCreateBody(title: '案', priority: 'high');
      expect(none['scope'], 'global');
      expect(none.containsKey('themeId'), isFalse);
    });

    test('テーマ変更は PATCH /idea-box/:id（themeId は数値、解除は null）', () async {
      final service = BacklogService(client);
      await service.updateIdeaTheme('5', '12');
      await service.updateIdeaTheme('5', null);
      expect(client.patches.map((p) => p.path), ['/idea-box/5', '/idea-box/5']);
      expect(client.patches[0].data, {'themeId': 12});
      expect(client.patches[1].data, {'themeId': null});
    });
  });
}
