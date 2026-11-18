/// Executions screen filter logic: search x theme x status x sort, no match,
/// clear, the status filter on auto-run cards (running / waiting for input),
/// and theme resolution from the task list (subtasks inherit the parent).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/models/theme_auto_run.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';

ExecutingTask _exec(String taskId, {String status = 'running', DateTime? started, DateTime? session, String? parentId}) =>
    ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      parentId: parentId,
      executionStatus: status,
      startedAt: started,
      sessionStartedAt: session,
    );

ResumableExecution _res(String id, String? taskId, {String? title, DateTime? started, DateTime? created, bool canResume = true}) =>
    ResumableExecution(
      id: id,
      taskId: taskId,
      taskTitle: title,
      status: 'interrupted',
      startedAt: started,
      createdAt: created,
      canResume: canResume,
    );

DateTime _t(int hour) => DateTime(2026, 11, 17, hour);

const _lookups = ExecLookups(
  titles: {'1': 'ログイン修正', '2': 'ログイン画面の文言', '3': '検索の高速化', '4': '子タスク'},
  themes: {'1': 'A', '2': 'B', '3': 'A', '4': 'B'},
);

final _executing = [
  _exec('1', started: _t(9)),
  _exec('2', status: 'waiting_for_input', started: _t(11)),
  _exec('3', status: 'waiting_for_input', session: _t(10)), // startedAt なし → sessionStartedAt
  _exec('9'), // 日時なし・タスク一覧に無い
];

List<String> _ids(List<ExecutingTask> list) => [for (final t in list) t.taskId];

void main() {
  group('実行中', () {
    test('既定は絞らず新しい順（startedAt → sessionStartedAt、日時なしは末尾）', () {
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(), _lookups)), ['2', '3', '1', '9']);
    });

    test('古い順でも日時なしは末尾', () {
      final f = const ExecFilter(sort: ExecSort.oldest);
      expect(_ids(applyExecutingFilter(_executing, f, _lookups)), ['1', '3', '2', '9']);
    });

    test('状態：実行中のみ／入力待ちのみ', () {
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(status: ExecStatusFilter.running), _lookups)),
          ['1', '9']);
      expect(
          _ids(applyExecutingFilter(_executing, const ExecFilter(status: ExecStatusFilter.waitingForInput), _lookups)),
          ['2', '3']);
    });

    test('テーマで絞る。テーマが引けないタスクは除く。サブタスクは親のテーマで引く', () {
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(themeIds: {'A'}), _lookups)), ['3', '1']);
      final sub = [_exec('77', parentId: '2', started: _t(8))];
      expect(_ids(applyExecutingFilter(sub, const ExecFilter(themeIds: {'B'}), _lookups)), ['77']);
      expect(_ids(applyExecutingFilter(sub, const ExecFilter(themeIds: {'A'}), _lookups)), isEmpty);
    });

    test('テーマを複数選ぶと、どれかに含まれるものを残す', () {
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(themeIds: {'A', 'B'}), _lookups)), ['2', '3', '1']);
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(themeIds: {'B', 'Z'}), _lookups)), ['2']);
    });

    test('検索はタスク名の部分一致（大文字小文字を区別しない）。タスク名が無ければ「タスク #id」で照合', () {
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(query: ' ログイン '), _lookups)), ['2', '1']);
      expect(_ids(applyExecutingFilter(_executing, const ExecFilter(query: '#9'), _lookups)), ['9']);
    });

    test('検索×テーマ×状態×古い順の組合せ', () {
      const f = ExecFilter(query: 'ログイン', themeIds: {'B'}, status: ExecStatusFilter.waitingForInput, sort: ExecSort.oldest);
      expect(_ids(applyExecutingFilter(_executing, f, _lookups)), ['2']);
      const g = ExecFilter(query: 'ログイン', themeIds: {'A'}, status: ExecStatusFilter.waitingForInput);
      expect(applyExecutingFilter(_executing, g, _lookups), isEmpty);
    });
  });

  group('再開可能', () {
    final resumable = [
      _res('r1', '1', started: _t(9)),
      _res('r2', '3', title: 'API 側のタイトル', created: _t(12)), // startedAt なし → createdAt
      _res('r3', null, title: '外れた実行', started: _t(10)),
      _res('r4', '2', started: _t(13), canResume: false),
    ];
    List<String> ids(ExecFilter f) => [for (final e in applyResumableFilter(resumable, f, _lookups)) e.id];

    test('canResume のみ、新しい順（startedAt → createdAt）', () {
      expect(ids(const ExecFilter()), ['r2', 'r3', 'r1']);
      expect(ids(const ExecFilter(sort: ExecSort.oldest)), ['r1', 'r3', 'r2']);
    });

    test('状態の絞り込みは再開可能に効かない', () {
      expect(ids(const ExecFilter(status: ExecStatusFilter.waitingForInput)), ['r2', 'r3', 'r1']);
    });

    test('検索は taskTitle を優先し、無ければタスク一覧の名前', () {
      expect(ids(const ExecFilter(query: 'api')), ['r2']);
      expect(ids(const ExecFilter(query: 'ログイン')), ['r1']);
    });

    test('テーマで絞ると taskId の無い実行は除く', () {
      expect(ids(const ExecFilter(themeIds: {'A'})), ['r2', 'r1']);
      expect(ids(const ExecFilter(themeIds: {'Z'})), isEmpty);
    });

    test('テーマを複数選ぶと、どれかのテーマの実行を残す', () {
      expect(ids(const ExecFilter(themeIds: {'A', 'B'})), ['r2', 'r1']);
    });
  });

  group('自動実行カード', () {
    final themes = [
      TaskTheme(id: 'A', name: 'Rapitas 開発', isDevelopment: true),
      TaskTheme(id: 'B', name: 'モバイル版', isDevelopment: true),
      TaskTheme(id: 'C', name: '社内ツール', isDevelopment: true),
    ];
    List<String> ids(ExecFilter f) => [for (final t in applyAutoRunThemeFilter(themes, f)) t.id];

    test('テーマ・テーマ名の検索で絞り、並び順は変えない', () {
      expect(ids(const ExecFilter(sort: ExecSort.oldest)), ['A', 'B', 'C']);
      expect(ids(const ExecFilter(themeIds: {'B'})), ['B']);
      expect(ids(const ExecFilter(query: 'rapitas')), ['A']);
      expect(ids(const ExecFilter(themeIds: {'B'}, query: 'rapitas')), isEmpty);
    });

    test('テーマを複数選ぶと選んだテーマのカードだけ、元の並びで残す', () {
      expect(ids(const ExecFilter(themeIds: {'C', 'A'})), ['A', 'C']);
      expect(ids(const ExecFilter(themeIds: {'C', 'A'}, query: 'rapitas')), ['A']);
    });

    // A: 自動実行中（現在のタスク 1 は入力待ち）、B: 自動実行中（現在のタスク 2 は実行中）、C: 一時停止中（現在のタスク 3 は入力待ち）
    final autoRuns = {
      'A': const ThemeAutoRunState(themeId: 'A', status: 'running', currentTaskId: '1'),
      'B': const ThemeAutoRunState(themeId: 'B', status: 'running', currentTaskId: '2'),
      'C': const ThemeAutoRunState(themeId: 'C', status: 'paused', currentTaskId: '3'),
    };
    final executing = [_exec('1', status: 'waiting_for_input'), _exec('2'), _exec('3', status: 'waiting_for_input')];
    List<String> byStatus(ExecFilter f, {Map<String, ThemeAutoRunState>? runs, List<ExecutingTask>? exec}) => [
          for (final t in applyAutoRunThemeFilter(themes, f, autoRuns: runs ?? autoRuns, executing: exec ?? executing))
            t.id,
        ];

    test('状態＝すべては状態で絞らない（一時停止中・状態未取得も残す）', () {
      expect(byStatus(const ExecFilter()), ['A', 'B', 'C']);
      expect(byStatus(const ExecFilter(), runs: const {}), ['A', 'B', 'C']);
    });

    test('状態＝実行中は自動実行中（running）のテーマだけ。idle・paused・stopping・未取得は出さない', () {
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.running)), ['A', 'B']);
      final others = {
        'A': const ThemeAutoRunState(themeId: 'A'),
        'B': const ThemeAutoRunState(themeId: 'B', status: 'stopping'),
      };
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.running), runs: others), isEmpty);
      // テーマ・検索の条件と重ねられ、並び順は元のまま
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.running, sort: ExecSort.oldest)), ['A', 'B']);
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.running, themeIds: {'B', 'C'})), ['B']);
    });

    test('状態＝入力待ちは自動実行中で、現在のタスクの実行が入力待ちのテーマだけ', () {
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.waitingForInput)), ['A'],
          reason: 'C は現在のタスクが入力待ちでも自動実行が一時停止中なので外す');
      // 現在のタスクが実行中リストに無ければ入力待ちに数えない
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.waitingForInput), exec: const []), isEmpty);
      final noCurrent = {'A': const ThemeAutoRunState(themeId: 'A', status: 'running')};
      expect(byStatus(const ExecFilter(status: ExecStatusFilter.waitingForInput), runs: noCurrent), isEmpty);
    });
  });

  group('条件', () {
    test('クリア（既定値）に戻すと全件・新しい順', () {
      const busy = ExecFilter(query: 'x', themeIds: {'A'}, sort: ExecSort.oldest, status: ExecStatusFilter.running);
      expect(busy.isDefault, isFalse);
      expect(busy.filtersExecuting, isTrue);
      const cleared = ExecFilter();
      expect(cleared.isDefault, isTrue);
      expect(cleared.filtersExecuting, isFalse);
      expect(cleared.filtersOthers, isFalse);
      expect(_ids(applyExecutingFilter(_executing, cleared, _lookups)), ['2', '3', '1', '9']);
    });

    test('状態は実行中・自動実行の絞り込みに数え、再開可能には数えない。並び順は絞り込みに数えない', () {
      const status = ExecFilter(status: ExecStatusFilter.waitingForInput);
      expect(status.filtersExecuting, isTrue);
      expect(status.filtersAutoRun, isTrue);
      expect(status.filtersOthers, isFalse);
      const sort = ExecFilter(sort: ExecSort.oldest);
      expect(sort.filtersExecuting, isFalse);
      expect(sort.filtersAutoRun, isFalse);
      expect(sort.isDefault, isFalse);
    });

    test('copyWith でテーマを「すべて」に戻せる', () {
      const f = ExecFilter(themeIds: {'A'}, query: 'q');
      expect(f.copyWith(themeIds: const {}), const ExecFilter(query: 'q'));
    });

    test('テーマの切り替えは足す・外すの往復で、集合の順序は等価判定に影響しない', () {
      const f = ExecFilter(themeIds: {'A'});
      expect(f.toggleTheme('B'), const ExecFilter(themeIds: {'A', 'B'}));
      expect(f.toggleTheme('B').toggleTheme('A'), const ExecFilter(themeIds: {'B'}));
      expect(f.toggleTheme('A'), const ExecFilter());
      expect(const ExecFilter(themeIds: {'A', 'B'}), const ExecFilter(themeIds: {'B', 'A'}));
      expect(const ExecFilter(themeIds: {'A', 'B'}).hashCode, const ExecFilter(themeIds: {'B', 'A'}).hashCode);
      expect(f.toggleTheme('B').isDefault, isFalse);
      expect(const ExecFilter(themeIds: {'A'}).filtersOthers, isTrue);
    });
  });

  test('タスク一覧からテーマの突合表を作る（サブタスクは親のテーマを継ぐ）', () {
    final at = DateTime(2026);
    Task task(String id, {String? themeId, List<Task>? subtasks}) =>
        Task(id: id, title: id, themeId: themeId, subtasks: subtasks, createdAt: at, updatedAt: at);
    final tasks = [
      task('1', themeId: 'A', subtasks: [task('11'), task('12', themeId: 'B')]),
      task('2'),
    ];
    expect(buildTaskThemeLookup(tasks), {'1': 'A', '11': 'A', '12': 'B'});
    expect(buildTaskThemeLookup(null), isEmpty);
  });
}
