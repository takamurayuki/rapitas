import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/task.dart';
import '../screens/home/home_screen.dart';
import '../screens/task_list/task_list_screen.dart';
import '../screens/task_detail/task_detail_screen.dart';
import '../screens/task_form/task_form_screen.dart';
import '../screens/agent_execution/agent_execution_screen.dart';
import '../screens/approvals/approvals_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/dashboard/dashboard_screen.dart';
import '../screens/settings/settings_screen.dart';
import '../screens/settings/voice_learning_screen.dart';
import '../screens/themes/themes_screen.dart';
import '../screens/themes/theme_form_screen.dart';
import '../screens/categories/categories_screen.dart';
import '../screens/categories/category_form_screen.dart';
import '../screens/backlog/ideas_screen.dart';
import '../screens/backlog/idea_form_screen.dart';
import '../screens/backlog/concerns_screen.dart';
import '../screens/backlog/concern_form_screen.dart';
import '../screens/backlog/hypotheses_screen.dart';
import '../screens/rapi/rapi_screen.dart';
import '../services/compose_requests.dart';
import '../services/voice_route_tracker.dart';

class AppRoutes {
  static const String home = '/';
  static const String tasks = '/tasks';
  static const String taskNew = '/tasks/new';
  static const String taskDetail = '/tasks/:id';
  static const String taskEdit = '/tasks/:id/edit';
  static const String executions = '/executions';
  static const String approvals = '/approvals';
  static const String notifications = '/notifications';
  static const String dashboard = '/dashboard';
  static const String settings = '/settings';
  static const String voiceLearning = '/settings/voice-learning';
  static const String themes = '/themes';
  static const String themeNew = '/themes/new';
  static const String themeEdit = '/themes/:id/edit';
  static const String categories = '/categories';
  static const String categoryNew = '/categories/new';
  static const String categoryEdit = '/categories/:id/edit';
  static const String ideas = '/ideas';
  static const String ideasNew = '/ideas/new';
  static const String concerns = '/concerns';
  static const String concernsNew = '/concerns/new';
  static const String hypotheses = '/hypotheses';
  static const String rapi = '/rapi';

  /// ディープリンク（rapitas://app/rapi?compose=1）で入力欄にフォーカスを求めるクエリ
  static const String composeQuery = 'compose';

  static final GoRouter router = createRouter(tracker: appVoiceRouteTracker);

  /// ルーターを作る。[tracker] は音声コマンド用のシート・ダイアログの見張り、
  /// [composeRequests] は入力欄へのフォーカス要求の窓口（どちらもテストでは自前のもの）
  static GoRouter createRouter({
    required VoiceRouteTracker tracker,
    String initialLocation = home,
    ComposeRequests? composeRequests,
  }) {
    final compose = composeRequests ?? appComposeRequests;
    return GoRouter(
      initialLocation: initialLocation,
      observers: [tracker.rootObserver],
      redirect: (context, state) => redirectFor(state.uri, compose),
      routes: [
        ShellRoute(
          observers: [tracker.shellObserver],
          builder: (context, state, child) {
            return ScaffoldWithNavBar(child: child);
          },
          routes: [
            GoRoute(
              path: home,
              pageBuilder: (context, state) => const NoTransitionPage(
                child: HomeScreen(),
              ),
            ),
            GoRoute(
              path: tasks,
              pageBuilder: (context, state) => const NoTransitionPage(
                child: TaskListScreen(),
              ),
            ),
            GoRoute(
              path: executions,
              pageBuilder: (context, state) => const NoTransitionPage(
                child: AgentExecutionScreen(),
              ),
            ),
            GoRoute(
              path: approvals,
              pageBuilder: (context, state) => const NoTransitionPage(
                child: ApprovalsScreen(),
              ),
            ),
            // ラピ（常駐エージェント）。下タブの最後
            GoRoute(
              path: rapi,
              pageBuilder: (context, state) => NoTransitionPage(
                child: RapiScreen(composeRequests: compose),
              ),
            ),
          ],
        ),
        // 設定は下タブから外した（ドロワーから push で開く）。戻るボタンは AppBar に任せる
        GoRoute(
          path: settings,
          builder: (context, state) => const SettingsScreen(),
        ),
        // 学習した読み替えの一覧（設定の「音声操作」から push で開く）
        GoRoute(
          path: voiceLearning,
          builder: (context, state) => const VoiceLearningScreen(),
        ),
        // NOTE: '/tasks/new' を '/tasks/:id' より先に宣言する（後だと id='new' として詳細に吸われる）
        GoRoute(
          path: taskNew,
          builder: (context, state) => const TaskFormScreen(),
        ),
        GoRoute(
          path: taskEdit,
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            final extra = state.extra;
            return TaskFormScreen(taskId: id, task: extra is Task ? extra : null);
          },
        ),
        GoRoute(
          path: taskDetail,
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            return TaskDetailScreen(taskId: id);
          },
        ),
        GoRoute(
          path: notifications,
          builder: (context, state) => const NotificationsScreen(),
        ),
        GoRoute(
          path: dashboard,
          builder: (context, state) => const DashboardScreen(),
        ),
        GoRoute(
          path: themes,
          builder: (context, state) => const ThemesScreen(),
        ),
        // NOTE: '/themes/new' を '/themes/:id/edit' より先に宣言する（タスク画面と同じく 'new' が id に取られないように）
        GoRoute(
          path: themeNew,
          builder: (context, state) => const ThemeFormScreen(),
        ),
        GoRoute(
          path: themeEdit,
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            final extra = state.extra;
            return ThemeFormScreen(themeId: id, theme: extra is TaskTheme ? extra : null);
          },
        ),
        GoRoute(
          path: categories,
          builder: (context, state) => const CategoriesScreen(),
        ),
        GoRoute(
          path: categoryNew,
          builder: (context, state) => const CategoryFormScreen(),
        ),
        GoRoute(
          path: categoryEdit,
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            final extra = state.extra;
            return CategoryFormScreen(categoryId: id, category: extra is TaskCategory ? extra : null);
          },
        ),
        GoRoute(
          path: ideas,
          builder: (context, state) => const IdeasScreen(),
        ),
        GoRoute(
          path: ideasNew,
          builder: (context, state) => const IdeaFormScreen(),
        ),
        GoRoute(
          path: concerns,
          builder: (context, state) => const ConcernsScreen(),
        ),
        GoRoute(
          path: concernsNew,
          builder: (context, state) => const ConcernFormScreen(),
        ),
        GoRoute(
          path: hypotheses,
          builder: (context, state) => const HypothesesScreen(),
        ),
      ],
    );
  }

  // ディープリンクで受け付けるパス。'/tasks/:id' のような可変部分は1階層の任意の文字列とする
  static final List<RegExp> _knownPaths = [
    for (final path in [
      home, tasks, taskNew, taskDetail, taskEdit, executions, approvals, notifications,
      dashboard, settings, voiceLearning, themes, themeNew, themeEdit, categories, categoryNew, categoryEdit,
      ideas, ideasNew, concerns, concernsNew, hypotheses, rapi,
    ])
      RegExp('^${path.replaceAll(RegExp(r':[A-Za-z]+'), '[^/]+')}\$'),
  ];

  /// [path] がこのアプリのどれかの画面に当たるか
  static bool isKnownPath(String path) => _knownPaths.any((re) => re.hasMatch(path));

  /// ルーターの redirect。ディープリンク（rapitas://app/<パス>）はホスト部を無視して
  /// パスだけで画面を決める（go_router の parser も uri.path しか見ない）。
  ///
  /// - `/rapi?compose=1`：入力欄へのフォーカスを要求してから、クエリを落とした `/rapi` へ
  ///   （クエリを残すと、タブを往復するたびにまたフォーカスしてしまう）
  /// - 知らないパス：ホームへ（router に errorBuilder がないので、手打ちの URL で行き止まりにしない）
  ///
  /// @param uri - 行き先 / ディープリンクならスキームとホストも含む
  /// @param compose - フォーカス要求の窓口
  /// @returns 書き換え先のパス。書き換えないなら null
  static String? redirectFor(Uri uri, ComposeRequests compose) {
    final path = uri.path.isEmpty ? home : uri.path;
    if (path == rapi && uri.queryParameters[composeQuery] == '1') {
      compose.request();
      return rapi;
    }
    if (!isKnownPath(path)) return home;
    return null;
  }
}

class ScaffoldWithNavBar extends StatelessWidget {
  final Widget child;

  const ScaffoldWithNavBar({super.key, required this.child});

  static int _calculateSelectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    if (location == AppRoutes.home) return 0;
    if (location.startsWith(AppRoutes.tasks)) return 1;
    if (location == AppRoutes.executions) return 2;
    if (location == AppRoutes.approvals) return 3;
    if (location == AppRoutes.rapi) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final selectedIndex = _calculateSelectedIndex(context);
    return Scaffold(
      body: child,
      // 音声操作モードの聞き取り表示は各画面のタイトルバー（actions の先頭。VoiceModeIndicator）
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: (index) {
          switch (index) {
            case 0:
              context.go(AppRoutes.home);
              break;
            case 1:
              context.go(AppRoutes.tasks);
              break;
            case 2:
              context.go(AppRoutes.executions);
              break;
            case 3:
              context.go(AppRoutes.approvals);
              break;
            case 4:
              context.go(AppRoutes.rapi);
              break;
          }
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'ホーム',
          ),
          NavigationDestination(
            icon: Icon(Icons.task_outlined),
            selectedIcon: Icon(Icons.task),
            label: 'タスク',
          ),
          NavigationDestination(
            icon: Icon(Icons.smart_toy_outlined),
            selectedIcon: Icon(Icons.smart_toy),
            label: '実行',
          ),
          NavigationDestination(
            icon: Icon(Icons.approval_outlined),
            selectedIcon: Icon(Icons.approval),
            label: '承認',
          ),
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'チャット',
          ),
        ],
      ),
    );
  }
}
