import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config/routes.dart';
import 'config/theme.dart';
import 'providers/pairing_provider.dart';
import 'providers/realtime_refresh_provider.dart';
import 'providers/settings_provider.dart';

class RapitasMobileApp extends ConsumerWidget {
  const RapitasMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    // デスクトップとのリアルタイム接続を起動中ずっと保ち、届いた変更で一覧を読み直す
    ref.watch(realtimeRefreshProvider);
    // ペアリングしたデスクトップの IP が変わったら、LAN 上で探し直して接続先を更新する
    ref.watch(desktopRelocatorProvider);

    return MaterialApp.router(
      title: 'Rapitas Mobile',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: AppRoutes.router,
      locale: const Locale('ja', 'JP'),
    );
  }
}
