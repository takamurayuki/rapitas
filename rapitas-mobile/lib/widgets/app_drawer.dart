import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/connection_provider.dart';
import '../providers/notification_provider.dart';
import '../providers/service_providers.dart';
import '../services/sse_service.dart';

// NOTE: パスは config/routes.dart の AppRoutes と同じ値。routes.dart → 各画面 → このファイル
// という import の循環を作らないよう、ここでは routes.dart を import せず文字列で持つ。
const String _home = '/';
const String _tasks = '/tasks';
const String _themes = '/themes';
const String _dashboard = '/dashboard';
const String _executions = '/executions';
const String _approvals = '/approvals';
const String _notifications = '/notifications';
const String _settings = '/settings';

/// ドロワーの1項目
class _DrawerDestination {
  final String label;
  final IconData icon;
  final String path;

  /// true なら context.push（シェル外の画面）、false なら context.go（タブ）
  final bool push;

  const _DrawerDestination(this.label, this.icon, this.path, {this.push = false});
}

const List<_DrawerDestination> _destinations = [
  _DrawerDestination('ホーム', Icons.home, _home),
  _DrawerDestination('タスク', Icons.task_alt, _tasks),
  _DrawerDestination('テーマ', Icons.palette, _themes, push: true),
  _DrawerDestination('ダッシュボード', Icons.dashboard, _dashboard, push: true),
  _DrawerDestination('実行', Icons.play_circle_outline, _executions),
  _DrawerDestination('承認', Icons.fact_check_outlined, _approvals),
  _DrawerDestination('通知', Icons.notifications_outlined, _notifications, push: true),
  _DrawerDestination('設定', Icons.settings_outlined, _settings),
];

/// ドロワー項目「通知」のインデックス（未読バッジ用）
const int _notificationsIndex = 6;

/// 現在のパスに対応するドロワー項目のインデックス。該当なしは -1。
///
/// タスクは一覧配下（/tasks/123 など）もタスク項目として扱う（下部ナビと同じ）。
int drawerSelectedIndex(String location) {
  if (location == _home) return 0;
  if (location == _tasks || location.startsWith('$_tasks/')) return 1;
  if (location == _themes) return 2;
  if (location == _dashboard) return 3;
  if (location == _executions) return 4;
  if (location == _approvals) return 5;
  if (location == _notifications) return 6;
  if (location == _settings) return 7;
  return -1;
}

/// 全タブ画面に付けるハンバーガーメニュー。デスクトップのサイドナビ相当。
class AppDrawer extends ConsumerWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).uri.path;
    final selectedIndex = drawerSelectedIndex(location);
    final unreadCount = ref.watch(unreadNotificationCountProvider);

    return Drawer(
      child: Column(
        children: [
          const _DrawerHeader(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(vertical: 8),
              children: [
                for (var i = 0; i < _destinations.length; i++)
                  ListTile(
                    leading: Icon(_destinations[i].icon),
                    title: Text(_destinations[i].label),
                    selected: i == selectedIndex,
                    trailing: i == _notificationsIndex && unreadCount > 0
                        ? Badge(label: Text('$unreadCount'))
                        : null,
                    onTap: () => _navigate(context, _destinations[i], i == selectedIndex),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _navigate(BuildContext context, _DrawerDestination destination, bool isCurrent) {
    // ドロワーを閉じた後も使えるよう、先にルーターを取っておく
    final router = GoRouter.of(context);
    // Navigator.pop だとシェル内外どちらの Navigator を pop するかが曖昧なので、
    // このドロワーを持つ Scaffold を直接閉じる
    Scaffold.maybeOf(context)?.closeDrawer();
    if (isCurrent) return;
    if (destination.push) {
      router.push(destination.path);
    } else {
      router.go(destination.path);
    }
  }
}

/// ブランドの紫グラデーションの帯。アプリ名と接続先デスクトップ。
class _DrawerHeader extends ConsumerWidget {
  const _DrawerHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ホームの接続ステータス帯と同じプロバイダ・値を使う
    final sseState = ref.watch(sseConnectionStateProvider).valueOrNull ?? SseConnectionState.idle;
    final desktopName = ref.watch(connectionSettingsProvider.select((s) => s.desktopName));

    final (Color dotColor, String label) = switch (sseState) {
      SseConnectionState.connected => (Colors.greenAccent, '接続中：${desktopName ?? 'デスクトップ'}'),
      SseConnectionState.connecting => (Colors.orangeAccent, '接続しています'),
      SseConnectionState.reconnecting => (Colors.orangeAccent, '再接続しています'),
      SseConnectionState.unauthorized => (Colors.white54, '未接続（QRコードでつなぎ直してください）'),
      SseConnectionState.idle => (Colors.white54, '未接続'),
    };
    final textTheme = Theme.of(context).textTheme;

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF8B5CF6), Color(0xFF6366F1)],
        ),
      ),
      padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 24, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Rapitas',
            style: textTheme.headlineSmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: textTheme.bodySmall?.copyWith(color: Colors.white),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
