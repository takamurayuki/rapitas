import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/settings_provider.dart';
import '../providers/voice_provider.dart';
import '../services/voice_command_flow.dart';
import '../services/voice_mode_listener.dart';
import '../services/voice_opened_screens.dart';
import '../services/voice_route_tracker.dart';
import 'voice_dismissible.dart';
import 'voice_input_sheet.dart';
import 'voice_scroll_target.dart';

/// 音声操作モードの土台。アプリ全体（MaterialApp の builder）を包み、
/// 常時聞き取り（VoiceModeListener）に「いま聞いてよいか」を伝え、シートを開く・画面を動かす口になる。
///
/// 聞いてよいのは、モードがオンで、次のどれでもない間：
/// - アプリが前面にない（resumed 以外。前面に戻ったら再開）
/// - キーボードが出ている
/// - テキスト入力欄にフォーカスがある
/// チャットのマイク・コマンドシートの聞き取り中は、DictationCoordinator 側で止まる。
/// コマンドシートを開いている間は、常時聞き取りが自分で止まっている（シートが閉じたら再開）。
class VoiceModeHost extends ConsumerStatefulWidget {
  final GoRouter router;
  final Widget child;

  const VoiceModeHost({super.key, required this.router, required this.child});

  @override
  ConsumerState<VoiceModeHost> createState() => _VoiceModeHostState();
}

class _VoiceModeHostState extends ConsumerState<VoiceModeHost>
    with WidgetsBindingObserver
    implements VoiceModeBinding {
  late final VoiceModeListener _listener;
  bool _foreground = true;
  bool _keyboard = false;
  bool _textFocus = false;
  bool _enabled = false;
  bool _syncScheduled = false;

  @override
  void initState() {
    super.initState();
    _listener = ref.read(voiceModeListenerProvider);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_onFocusChanged);
    _textFocus = _hasTextFocus();
    _schedule(() => _listener.attach(this));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    FocusManager.instance.removeListener(_onFocusChanged);
    final listener = _listener;
    // NOTE: 破棄の途中で聞き取り表示を描き直させないよう、外すのは後で
    scheduleMicrotask(() => listener.detach(this));
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // inactive（通知センター・権限ダイアログ）・hidden・paused では止め、resumed で再開する
    final foreground = state == AppLifecycleState.resumed;
    if (foreground == _foreground) return;
    _foreground = foreground;
    _sync();
  }

  /// 入力欄（EditableText）にフォーカスがあるか
  static bool _hasTextFocus() {
    final context = FocusManager.instance.primaryFocus?.context;
    if (context == null) return false;
    return context.widget is EditableText || context.findAncestorStateOfType<EditableTextState>() != null;
  }

  void _onFocusChanged() {
    final focus = _hasTextFocus();
    if (focus == _textFocus) return;
    _textFocus = focus;
    _sync();
  }

  /// build 中は聞き取り表示を描き直せないので、そのときは次のフレームで
  void _schedule(VoidCallback action) {
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks ||
        SchedulerBinding.instance.schedulerPhase == SchedulerPhase.midFrameMicrotasks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) action();
      });
    } else {
      action();
    }
  }

  void _sync() {
    if (_syncScheduled) return;
    _syncScheduled = true;
    _schedule(() {
      _syncScheduled = false;
      _listener.update(
        enabled: _enabled,
        allowed: _foreground && !_keyboard && !_textFocus,
      );
    });
  }

  // ---- VoiceModeBinding ----

  @override
  String currentPath() => widget.router.state.uri.path;

  @override
  ProviderContainer get container => ProviderScope.containerOf(context, listen: false);

  @override
  VoiceUi createUi() => AppVoiceUi(
        router: widget.router,
        messenger: ScaffoldMessenger.of(context),
        tracker: ref.read(voiceRouteTrackerProvider),
      );

  @override
  Future<void> openSheet(String path, {String? initialText}) async {
    final navigatorContext = widget.router.routerDelegate.navigatorKey.currentContext;
    if (navigatorContext == null || !mounted) return;
    await VoiceInputSheet.show(navigatorContext, path: path, ui: createUi(), initialText: initialText);
  }

  @override
  void onPermissionLost() {
    ref.read(voiceCommandModeProvider.notifier).setEnabled(false);
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(
        content: Text('マイクと音声認識の許可が無いため、音声操作モードをオフにしました'),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final enabled = ref.watch(voiceCommandModeProvider);
    final keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    if (enabled != _enabled || keyboard != _keyboard) {
      _enabled = enabled;
      _keyboard = keyboard;
      _sync();
    }
    return widget.child;
  }
}

/// 音声コマンドの画面操作（アプリの GoRouter・ScaffoldMessenger を使う）
class AppVoiceUi implements VoiceUi {
  final GoRouter router;
  final ScaffoldMessengerState messenger;
  final VoiceRouteTracker tracker;
  Route<dynamic>? _sheet;

  AppVoiceUi({required this.router, required this.messenger, required this.tracker});

  @override
  void attachSheet(Route<dynamic> route) => _sheet = route;

  @override
  void closeSheet() {
    final sheet = _sheet;
    if (sheet == null || !sheet.isActive) return;
    final navigator = sheet.navigator;
    if (navigator == null) return;
    if (sheet.isCurrent) {
      navigator.pop();
    } else {
      navigator.removeRoute(sheet);
    }
  }

  // 声で開いた画面は入力欄に自動でフォーカスしない（VoiceOpenedScreens）。目印は開く直前に付ける
  @override
  void go(String path) {
    VoiceOpenedScreens.markOpened(path);
    router.go(path);
  }

  @override
  void push(String path, {Object? extra}) {
    VoiceOpenedScreens.markOpened(path);
    router.push(path, extra: extra);
  }

  @override
  bool back() {
    // ドロワー・検索モードが出ていれば、画面を戻す前にそちらを閉じる（端末の戻るボタンと同じ順）
    if (VoiceDismissible.dismissTop()) return true;
    if (!router.canPop()) return false;
    router.pop();
    return true;
  }

  @override
  bool closePopup() => tracker.closeTopPopup() || VoiceDismissible.dismissTop();

  @override
  bool scroll(String path, {required bool down}) => VoiceScrollTarget.scroll(path, down: down);

  @override
  bool refresh(String path) => VoiceScrollTarget.refresh(path);

  @override
  void showMessage(String message) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 3)));
  }
}
