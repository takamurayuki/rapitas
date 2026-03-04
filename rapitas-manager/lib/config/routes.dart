import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../screens/home/home_screen.dart';
import '../screens/task_list/task_list_screen.dart';
import '../screens/task_detail/task_detail_screen.dart';
import '../screens/agent_execution/agent_execution_screen.dart';
import '../screens/approvals/approvals_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/dashboard/dashboard_screen.dart';
import '../screens/settings/settings_screen.dart';

class AppRoutes {
  static const String home = '/';
  static const String tasks = '/tasks';
  static const String taskDetail = '/tasks/:id';
  static const String executions = '/executions';
  static const String approvals = '/approvals';
  static const String notifications = '/notifications';
  static const String dashboard = '/dashboard';
  static const String settings = '/settings';

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
          GoRoute(
            path: settings,
            pageBuilder: (context, state) => const NoTransitionPage(
              child: SettingsScreen(),
            ),
          ),
        ],
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
    if (location == AppRoutes.settings) return 4;
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
              context.go(AppRoutes.settings);
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
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: '設定',
          ),
        ],
      ),
    );
  }
}
