import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/voice_provider.dart';
import '../services/voice_command_flow.dart';
import '../services/voice_route_tracker.dart';
import 'voice_input_sheet.dart';
import 'voice_scroll_target.dart';

/// 音声コマンドの入口（全画面の左下に置く小さい FAB）。押すと音声コマンドのシートを開く。
///
/// 置き場所：下タブの画面はシェルの Scaffold（startFloat）、push で開く画面は [VoiceFabFrame]、
/// チャット画面は入力欄の上（チャットの入力欄のマイクはラピへの発話用で、役割が違う）。
/// キーボード表示中・ドロワー表示中・下タブ側にシートが出ている間は隠す。
class VoiceFab extends ConsumerStatefulWidget {
  /// 開く前に呼ぶ（チャット画面の読み上げ入力を止めるなど）
  final VoidCallback? onBeforeOpen;

  /// 下タブ側（ShellRoute の Navigator）にシート・ダイアログが出ている間は隠すか。
  /// シェルの FAB は本文より手前に描かれるため、隠さないとシートの上に浮いてしまう
  final bool hideOverShellPopups;

  const VoiceFab({super.key, this.onBeforeOpen, this.hideOverShellPopups = false});

  static final ValueNotifier<int> _openDrawers = ValueNotifier(0);

  /// AppDrawer が開いた・閉じたときに呼ぶ（開いている間は隠す）
  static void drawerOpened() => _openDrawers.value++;
  static void drawerClosed() => _openDrawers.value = _openDrawers.value > 0 ? _openDrawers.value - 1 : 0;

  @override
  ConsumerState<VoiceFab> createState() => _VoiceFabState();
}

class _VoiceFabState extends ConsumerState<VoiceFab> {
  VoiceRouteTracker? _tracker;

  @override
  void initState() {
    super.initState();
    VoiceFab._openDrawers.addListener(_changed);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final tracker = ref.read(voiceRouteTrackerProvider);
    if (!identical(tracker, _tracker)) {
      _tracker?.removeListener(_changed);
      _tracker = tracker..addListener(_changed);
    }
  }

  @override
  void dispose() {
    VoiceFab._openDrawers.removeListener(_changed);
    _tracker?.removeListener(_changed);
    super.dispose();
  }

  /// NOTE: ドロワー・Navigator の変化は build 中に届くことがあるので、そのときは次のフレームで描き直す
  void _changed() {
    if (!mounted) return;
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    } else {
      setState(() {});
    }
  }

  void _open() {
    widget.onBeforeOpen?.call();
    final router = GoRouter.of(context);
    final ui = AppVoiceUi(
      router: router,
      messenger: ScaffoldMessenger.of(context),
      tracker: ref.read(voiceRouteTrackerProvider),
    );
    VoiceInputSheet.show(context, path: router.state.uri.path, ui: ui);
  }

  @override
  Widget build(BuildContext context) {
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    final hidden = keyboardOpen ||
        VoiceFab._openDrawers.value > 0 ||
        (widget.hideOverShellPopups && (_tracker?.hasShellPopup ?? false));
    if (hidden) return const SizedBox.shrink();
    return FloatingActionButton.small(
      key: const ValueKey('voice-command-fab'),
      heroTag: null,
      tooltip: '音声で操作',
      onPressed: _open,
      child: const Icon(Icons.settings_voice),
    );
  }
}

/// push で開く画面（シェルの外）に音声ボタンを付ける枠。
/// 外側の Scaffold が FAB とスナックバーを受け持つ（スナックバーが出ると FAB が上へよける）
class VoiceFabFrame extends StatelessWidget {
  final Widget child;

  const VoiceFabFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // キーボードは中の画面の Scaffold に任せる（ボタンはキーボード表示中は隠れる）
      resizeToAvoidBottomInset: false,
      body: child,
      floatingActionButton: const VoiceFab(),
      floatingActionButtonLocation: FloatingActionButtonLocation.startFloat,
    );
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

  @override
  void go(String path) => router.go(path);

  @override
  void push(String path, {Object? extra}) => router.push(path, extra: extra);

  @override
  bool back() {
    if (!router.canPop()) return false;
    router.pop();
    return true;
  }

  @override
  bool closePopup() => tracker.closeTopPopup();

  @override
  bool scroll(String path, {required bool down}) => VoiceScrollTarget.scroll(path, down: down);

  @override
  void showMessage(String message) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 3)));
  }
}
