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

  static final GoRouter router = GoRouter(
    initialLocation: home,
    routes: [
      ShellRoute(
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
            pageBuilder: (context, state) => const NoTransitionPage(
              child: RapiScreen(),
            ),
          ),
        ],
      ),
      // 設定は下タブから外した（ドロワーから push で開く）。戻るボタンは AppBar に任せる
      GoRoute(
        path: settings,
        builder: (context, state) => const SettingsScreen(),
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
          return ThemeFormScreen(
            themeId: id,
            theme: extra is TaskTheme ? extra : null,
          );
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
          return CategoryFormScreen(
            categoryId: id,
            category: extra is TaskCategory ? extra : null,
          );
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
