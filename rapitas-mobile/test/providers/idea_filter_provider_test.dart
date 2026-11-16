import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';

/// getIdeas の引数を記録する BacklogService。
class _RecordingBacklog implements BacklogService {
  final List<Map<String, String?>> calls = [];

  @override
  Future<List<Idea>> getIdeas({
    String? themeId,
    String? priority,
    String? status,
    String? search,
  }) async {
    calls.add({'themeId': themeId, 'priority': priority, 'status': status, 'search': search});
    return const [];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _RecordingBacklog backlog;
  late ProviderContainer container;

  setUp(() {
    backlog = _RecordingBacklog();
    container = ProviderContainer(overrides: [
      backlogServiceProvider.overrideWithValue(backlog),
    ]);
  });

  tearDown(() => container.dispose());

  test('初期状態は絞り込みなし（status 等を送らない＝改修前の見え方）', () async {
    expect(container.read(ideaFilterProvider), const IdeaFilter());
    await container.read(ideaListProvider.future);
    expect(backlog.calls.single,
        {'themeId': null, 'priority': null, 'status': null, 'search': ''});
  });

  test('条件を変えると、その条件で取り直す（キーワードは前後の空白を落とす）', () async {
    await container.read(ideaListProvider.future);
    container.read(ideaFilterProvider.notifier).state =
        const IdeaFilter(themeId: '5', priority: 'low', status: 'open', search: ' 音声 ');
    await container.read(ideaListProvider.future);
    expect(backlog.calls.last,
        {'themeId': '5', 'priority': 'low', 'status': 'open', 'search': '音声'});
  });

  test('invalidate（引っ張って更新・削除後）でも条件を保つ', () async {
    container.read(ideaFilterProvider.notifier).state = const IdeaFilter(status: 'used');
    await container.read(ideaListProvider.future);
    container.invalidate(ideaListProvider);
    await container.read(ideaListProvider.future);
    expect(backlog.calls, hasLength(2));
    expect(backlog.calls.last['status'], 'used');
  });

  group('IdeaFilter', () {
    test('== は全項目を比較する', () {
      expect(const IdeaFilter(), const IdeaFilter());
      expect(const IdeaFilter(themeId: '1') == const IdeaFilter(), isFalse);
      expect(const IdeaFilter(priority: 'high') == const IdeaFilter(), isFalse);
      expect(const IdeaFilter(status: 'open') == const IdeaFilter(), isFalse);
      expect(const IdeaFilter(search: 'a') == const IdeaFilter(), isFalse);
    });

    test('copyWith の clear で個別に外せる', () {
      const f = IdeaFilter(themeId: '1', priority: 'high', status: 'used', search: 'a');
      expect(f.copyWith(clearThemeId: true).themeId, isNull);
      expect(f.copyWith(clearPriority: true).priority, isNull);
      expect(f.copyWith(clearStatus: true).status, isNull);
      expect(f.copyWith(search: '').search, '');
      expect(
        f.copyWith(clearThemeId: true, clearPriority: true, clearStatus: true, search: ''),
        const IdeaFilter(),
      );
    });
  });
}
