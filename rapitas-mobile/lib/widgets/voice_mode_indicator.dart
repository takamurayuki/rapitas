import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_mode_listener.dart';

/// 音声操作モードの聞き取り表示（小さな印。タップ範囲 40×40、見た目は [dotSize] 四方の中）。
/// モードがオフの間は何も出さない（幅も取らない）。状態は文字を使わず、標準のアイコンと色で見せる（[VoiceModeDot]）。
/// マイク等の音声アイコンは使わない（チャット入力欄のマイクと意味が被るため）。
/// タップでコマンドシートを手で開ける（聞き取りに失敗したときの予備）。
///
/// 置き場所は各画面のタイトルバー（AppBar）の `actions` の先頭：既存のアイコン類はその右に並ぶ。
/// - 既存のアイコンがある画面：`const VoiceModeIndicator(trailing: false)` を先頭に置く。
/// - アイコンが無い画面：`const VoiceModeIndicator()` だけを置く（右端になる）。右に [trailingInset] の余白を取り、
///   丸の中心は画面の右端から 28px（= 標準の leading の中心と左右対称。ラピ画面のガラスのハンバーガーとも対称）。
/// キーボード表示中もタイトルバーは残るので出したまま（状態は一時停止になる）。ドロワー表示中は隠す。
class VoiceModeIndicator extends ConsumerStatefulWidget {
  const VoiceModeIndicator({super.key, this.trailing = true});

  /// バーの右端（actions の最後）に置くとき true：右に [trailingInset] の余白を取る。
  /// 既存のアイコンの左隣（先頭）に置くときは false（右のアイコンは従来どおり端まで並ぶ）。
  final bool trailing;

  /// 見た目の大きさ（アイコンはこの四方の中に収める）
  static const double dotSize = 30;

  /// タップできる範囲（幅・高さ）
  static const double hitSize = 40;

  /// タイトルバーの中で取る幅（標準の IconButton と同じ 48。丸はその中央）
  static const double slotWidth = 48;

  /// 右端に置くときの画面の右端との間の余白（AppBar の actions には既定で余白が無い）
  static const double trailingInset = 4;

  static final ValueNotifier<int> _openDrawers = ValueNotifier(0);

  /// AppDrawer が開いた・閉じたときに呼ぶ（開いている間は隠す）
  static void drawerOpened() => _openDrawers.value++;
  static void drawerClosed() => _openDrawers.value = _openDrawers.value > 0 ? _openDrawers.value - 1 : 0;

  @override
  ConsumerState<VoiceModeIndicator> createState() => _VoiceModeIndicatorState();
}

class _VoiceModeIndicatorState extends ConsumerState<VoiceModeIndicator> {
  @override
  void initState() {
    super.initState();
    VoiceModeIndicator._openDrawers.addListener(_changed);
  }

  @override
  void dispose() {
    VoiceModeIndicator._openDrawers.removeListener(_changed);
    super.dispose();
  }

  /// NOTE: ドロワーの変化は build 中に届くことがあるので、そのときは次のフレームで描き直す
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

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(voiceModeListenerProvider.select((l) => l.status));
    final ignored = ref.watch(voiceModeListenerProvider.select((l) => l.recentlyIgnored));
    final hidden = status == VoiceModeStatus.off || VoiceModeIndicator._openDrawers.value > 0;
    if (hidden) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsetsDirectional.only(end: widget.trailing ? VoiceModeIndicator.trailingInset : 0),
      child: SizedBox(
        width: VoiceModeIndicator.slotWidth,
        child: Center(
          child: VoiceModeDot(
            status: status,
            recentlyIgnored: ignored,
            onTap: () => ref.read(voiceModeListenerProvider).openSheetManually(),
          ),
        ),
      ),
    );
  }
}

/// 聞き取り表示の印そのもの（状態だけで描く。描画確認でも使う）。文字は使わず、Material の標準アイコンと色で状態を表す：
/// - 話せます（入力なし）：more_horiz（紺）。ごくゆっくり明滅する
/// - 声を受け取り中：graphic_eq（緑）
/// - 処理中：autorenew（紫）が回る
/// - 回答待ち：help（オレンジ）
/// - 準備中・再開中：more_horiz（薄い藍。受付可能とは見せない）
/// - 一時停止：pause（グレー）
/// - 使えない：block（濃いグレー）
/// アイコンは [iconSize] で [VoiceModeIndicator.dotSize] 四方の中に収め、タップ範囲は [VoiceModeIndicator.hitSize]。
/// アウトラインや囲みは付けない。理由や認識した文は文章でここには出さない（読み上げ・ツールチップと、タップで開くコマンドシートに寄せる）。
///
/// NOTE: graphic_eq は静止アイコンなので、受け取り中の表示は音量に連動させない（音量の受け口も持たない）。
class VoiceModeDot extends StatefulWidget {
  final VoiceModeStatus status;
  final VoidCallback? onTap;

  /// 直前の発話をコマンドではないとして聞き流した直後か（印は変えず、読み上げの説明にだけ足す）
  final bool recentlyIgnored;

  const VoiceModeDot({super.key, required this.status, this.onTap, this.recentlyIgnored = false});

  /// アイコンの大きさ（見本 indicator-mock-v5.html と同じ 26。[VoiceModeIndicator.dotSize] の中に収まる）
  static const double iconSize = 26;

  static const Color navy = Color(0xFF3949AB);
  static const Color faint = Color(0xFFC5CAE9);

  // NOTE: ダークのバーでは明暗が逆に見える（薄い印のほうが紺より目立ち、準備中が話せますより強く見える）ので、
  // ダークでは「話せます」を明るい藍、「準備中」を暗い藍にして、強弱の関係を保つ
  static const Color navyOnDark = Color(0xFF9FA8DA);
  static const Color faintOnDark = Color(0xFF3C4366);
  static const Color green = Color(0xFF2E9E4F);
  static const Color purple = Color(0xFF9C27B0);
  static const Color orange = Color(0xFFF57C00);
  static const Color grey = Color(0xFF9CA3AF);
  static const Color darkGrey = Color(0xFF6B7280);

  // NOTE: ダークのバーでは濃いグレーが背景に沈むので、「使えない」は明るめのグレーにする（一時停止より少し明るい）
  static const Color darkGreyOnDark = Color(0xFFB8BEC8);

  /// 明滅（話せます）の 1 往復の半分。目立たせないよう、ごくゆっくり
  static const Duration breatheHalf = Duration(milliseconds: 2000);

  /// アイコンが 1 周する（処理中）時間
  static const Duration spinCycle = Duration(milliseconds: 1600);

  /// 状態ごとのアイコン（描画確認・テスト用）
  ///
  /// @param status - 状態 / 聞き取り表示の状態
  /// @returns 表示するアイコン / アイコン
  static IconData iconOf(VoiceModeStatus status) => switch (status) {
        VoiceModeStatus.ready || VoiceModeStatus.preparing => Icons.more_horiz,
        VoiceModeStatus.hearing => Icons.graphic_eq,
        VoiceModeStatus.processing => Icons.autorenew,
        VoiceModeStatus.awaiting => Icons.help,
        VoiceModeStatus.paused || VoiceModeStatus.off => Icons.pause,
        VoiceModeStatus.unavailable => Icons.block,
      };

  /// 状態ごとのアイコンの色
  ///
  /// @param status - 状態 / 聞き取り表示の状態
  /// @param brightness - テーマの明暗 / ライトかダークか
  /// @returns アイコンの色 / 色
  static Color colorOf(VoiceModeStatus status, [Brightness brightness = Brightness.light]) {
    final dark = brightness == Brightness.dark;
    return switch (status) {
      VoiceModeStatus.ready => dark ? navyOnDark : navy,
      VoiceModeStatus.hearing => green,
      VoiceModeStatus.processing => purple,
      VoiceModeStatus.awaiting => orange,
      VoiceModeStatus.preparing => dark ? faintOnDark : faint,
      VoiceModeStatus.paused || VoiceModeStatus.off => grey,
      VoiceModeStatus.unavailable => dark ? darkGreyOnDark : darkGrey,
    };
  }

  /// 読み上げ・ツールチップの説明
  ///
  /// @param status - 状態 / 聞き取り表示の状態
  /// @param recentlyIgnored - 直前の発話を聞き流した直後か / 聞き流した直後なら true
  /// @returns 説明の文 / 説明文
  static String labelOf(VoiceModeStatus status, {bool recentlyIgnored = false}) {
    final base = switch (status) {
      VoiceModeStatus.off => '音声操作モードはオフです',
      VoiceModeStatus.paused => '音声操作：一時停止中（入力欄・キーボード・ほかの音声入力の間は聞きません）',
      VoiceModeStatus.preparing => '音声操作：準備中（聞き取りを始めています）',
      VoiceModeStatus.ready => '音声操作：話せます',
      VoiceModeStatus.hearing => '音声操作：声を受け取っています',
      VoiceModeStatus.processing => '音声操作：処理中',
      VoiceModeStatus.awaiting => '音声操作：回答待ち（コマンドシートの質問に答えてください）',
      VoiceModeStatus.unavailable => '音声操作：聞き取りを始められません',
    };
    final listening = status == VoiceModeStatus.ready || status == VoiceModeStatus.preparing;
    return recentlyIgnored && listening ? '$base。直前の発話はコマンドではなかったので聞き流しました' : base;
  }

  @override
  State<VoiceModeDot> createState() => _VoiceModeDotState();
}

class _VoiceModeDotState extends State<VoiceModeDot> with SingleTickerProviderStateMixin {
  late final AnimationController _motion = AnimationController(vsync: this);

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(VoiceModeDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) _sync();
  }

  @override
  void dispose() {
    _motion.dispose();
    super.dispose();
  }

  /// 状態に合わせて動きを切り替える（動かない状態では止める）
  void _sync() {
    _motion.stop();
    switch (widget.status) {
      case VoiceModeStatus.ready:
        _motion.duration = VoiceModeDot.breatheHalf;
        _motion.value = 0;
        _motion.repeat(reverse: true);
      case VoiceModeStatus.processing:
        _motion.duration = VoiceModeDot.spinCycle;
        _motion.value = 0;
        _motion.repeat();
      case VoiceModeStatus.hearing ||
            VoiceModeStatus.awaiting ||
            VoiceModeStatus.preparing ||
            VoiceModeStatus.unavailable ||
            VoiceModeStatus.paused ||
            VoiceModeStatus.off:
        _motion.value = 0;
    }
  }

  Widget _icon() {
    final status = widget.status;
    final icon = Icon(
      VoiceModeDot.iconOf(status),
      key: const ValueKey('voice-mode-icon'),
      size: VoiceModeDot.iconSize,
      color: VoiceModeDot.colorOf(status, Theme.of(context).brightness),
    );
    switch (status) {
      case VoiceModeStatus.ready:
        // ごくゆっくり明滅（不透明度 1.0 ⇄ 0.55）。消えたように見えるほどは暗くしない
        return FadeTransition(
          key: const ValueKey('voice-mode-breathe'),
          opacity: _motion.drive(Tween(begin: 1.0, end: 0.55).chain(CurveTween(curve: Curves.easeInOut))),
          child: icon,
        );
      case VoiceModeStatus.processing:
        return RotationTransition(key: const ValueKey('voice-mode-spin'), turns: _motion, child: icon);
      case VoiceModeStatus.hearing ||
            VoiceModeStatus.awaiting ||
            VoiceModeStatus.preparing ||
            VoiceModeStatus.unavailable ||
            VoiceModeStatus.paused ||
            VoiceModeStatus.off:
        return icon;
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.status;
    final label = VoiceModeDot.labelOf(status, recentlyIgnored: widget.recentlyIgnored);
    const size = VoiceModeIndicator.dotSize;
    const hitSize = VoiceModeIndicator.hitSize;

    final mark = SizedBox.square(
      key: ValueKey('voice-mode-dot-${status.name}'),
      dimension: size,
      child: Center(
        // 状態が変わるときは短く入れ替える（張り直しの合間の「準備中」がちらつきに見えないように）
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: KeyedSubtree(key: ValueKey(status), child: _icon()),
        ),
      ),
    );

    return Semantics(
      button: true,
      label: label,
      hint: 'タップでコマンドシートを開きます',
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        // 置き場所に Material が無くても波紋が出るよう、透明な Material を敷く
        child: Material(
          type: MaterialType.transparency,
          child: InkResponse(
            key: const ValueKey('voice-mode-indicator'),
            onTap: widget.onTap,
            radius: hitSize / 2,
            child: SizedBox(
              width: hitSize,
              height: hitSize,
              // 毎フレーム描き直す動き（明滅・回転）を印の中だけに閉じ込め、タイトルバー等まで描き直させない
              child: Center(
                child: RepaintBoundary(key: const ValueKey('voice-mode-lamp-boundary'), child: mark),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
