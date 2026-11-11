import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/connection_provider.dart';
import '../providers/notification_provider.dart';
import '../providers/service_providers.dart';
import '../services/sse_service.dart';
import 'voice_dismissible.dart';
import 'voice_mode_indicator.dart';

// NOTE: パスは config/routes.dart の AppRoutes と同じ値。routes.dart → 各画面 → このファイル
// という import の循環を作らないよう、ここでは routes.dart を import せず文字列で持つ。
const String _themes = '/themes';
const String _categories = '/categories';
const String _ideas = '/ideas';
const String _concerns = '/concerns';
const String _hypotheses = '/hypotheses';
const String _dashboard = '/dashboard';
const String _notifications = '/notifications';
const String _settings = '/settings';

/// ドロワーの1項目。どれもシェル外の画面なので context.push で開く。
class _DrawerDestination {
  final String label;
  final IconData icon;
  final String path;

  const _DrawerDestination(this.label, this.icon, this.path);
}

// NOTE: 下タブ（ホーム／タスク／実行／承認）にある画面はここに入れない（重複させない）。
// ドロワーは下タブ以外の画面への入口。
const List<_DrawerDestination> _destinations = [
  _DrawerDestination('テーマ', Icons.palette, _themes),
  _DrawerDestination('カテゴリ', Icons.folder_outlined, _categories),
  _DrawerDestination('アイデア', Icons.lightbulb_outline, _ideas),
  _DrawerDestination('懸念', Icons.report_problem_outlined, _concerns),
  _DrawerDestination('仮説', Icons.science_outlined, _hypotheses),
  _DrawerDestination('ダッシュボード', Icons.dashboard, _dashboard),
  _DrawerDestination('通知', Icons.notifications_outlined, _notifications),
  _DrawerDestination('設定', Icons.settings_outlined, _settings),
];

/// ドロワー項目「通知」のインデックス（未読バッジ用）
const int _notificationsIndex = 6;

/// 現在のパスに対応するドロワー項目のインデックス。該当なしは -1。
///
/// 下タブの画面（/、/tasks 配下、/executions、/approvals）はドロワーに無いので -1。
/// 一覧の配下（/themes/new、/ideas/new など）は一覧項目として扱わない（完全一致のみ）。
int drawerSelectedIndex(String location) {
  if (location == _themes) return 0;
  if (location == _categories) return 1;
  if (location == _ideas) return 2;
  if (location == _concerns) return 3;
  if (location == _hypotheses) return 4;
  if (location == _dashboard) return 5;
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

    return _HidesVoiceIndicator(
      child: Drawer(
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
    router.push(destination.path);
  }
}

/// ドロワーが出ている間（開く・閉じるアニメーション中を含む）は、タイトルバーの音声操作の聞き取り表示を隠す。
/// Scaffold はドロワーを開いている間だけ中身を作るので、作られている間＝出ている間。
/// 出ている間は、音声の「閉じる」「戻る」でドロワーを閉じられるようにもする（ドロワーはルートではないので
/// シート・ダイアログ用の VoiceRouteTracker からは見えない）。
class _HidesVoiceIndicator extends StatefulWidget {
  final Widget child;

  const _HidesVoiceIndicator({required this.child});

  @override
  State<_HidesVoiceIndicator> createState() => _HidesVoiceIndicatorState();
}

class _HidesVoiceIndicatorState extends State<_HidesVoiceIndicator> {
  @override
  void initState() {
    super.initState();
    VoiceModeIndicator.drawerOpened();
  }

  @override
  void dispose() {
    VoiceModeIndicator.drawerClosed();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => VoiceDismissible(
        onDismiss: () => Scaffold.maybeOf(context)?.closeDrawer(),
        child: widget.child,
      );
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
