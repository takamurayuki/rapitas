import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config/routes.dart';
import 'config/theme.dart';
import 'providers/companion_provider.dart';
import 'providers/home_widget_sync_provider.dart';
import 'providers/pairing_provider.dart';
import 'providers/pending_request_provider.dart';
import 'providers/rapi_chat_spaces_provider.dart';
import 'providers/realtime_refresh_provider.dart';
import 'providers/settings_provider.dart';
import 'widgets/voice_mode_host.dart';

class RapitasMobileApp extends ConsumerWidget {
  const RapitasMobileApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    // デスクトップとのリアルタイム接続を起動中ずっと保ち、届いた変更で一覧を読み直す
    ref.watch(realtimeRefreshProvider);
    // ペアリングしたデスクトップの IP が変わったら、LAN 上で探し直して接続先を更新する
    ref.watch(desktopRelocatorProvider);
    // ホーム画面ウィジェットへ、承認待ち・実行中・今日のタスクのスナップショットを書き出す（iOS のみ）
    ref.watch(homeWidgetSyncProvider);
    // ショートカットが預けた依頼の取り込みと、裏へ回る直前のウィジェットの書き出し（iOS のみ）
    ref.watch(homeScreenLifecycleProvider);
    // 伴走の要約を、起動して接続設定が読めたとき・裏から戻ったときに読み直す（プッシュはしない。設計 Q5）
    ref.watch(companionDigestLifecycleProvider);
    // ラピの会話スペース：起動時に最後の会話を開き、裏へ回る・前面に戻るときに保存待ちを送る
    ref.watch(rapiChatSpacesBootProvider);

    return MaterialApp.router(
      title: 'Rapitas Mobile',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: AppRoutes.router,
      // 音声操作モードの常時聞き取り（設定でオンにしたときだけ聞く）
      builder: (context, child) => VoiceModeHost(
        router: AppRoutes.router,
        child: child ?? const SizedBox.shrink(),
      ),
      locale: const Locale('ja', 'JP'),
    );
  }
}
