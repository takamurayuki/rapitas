import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/voice_provider.dart';
import '../services/voice_mode_listener.dart';
import 'voice_mode_glyphs.dart';

/// 音声操作モードの聞き取り表示（小さな印。タップ範囲 40×40、見た目は [dotSize] 四方の中）。
/// モードがオフの間は何も出さない（幅も取らない）。状態は文字を使わず形で見せる（[VoiceModeDot]）。
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

  /// 見た目の大きさ（形はこの四方の中に収める）
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
            level: ref.watch(soundLevelMeterProvider).level,
            onTap: () => ref.read(voiceModeListenerProvider).openSheetManually(),
          ),
        ),
      ),
    );
  }
}

/// 聞き取り表示の形そのもの（状態だけで描く。描画確認でも使う）。文字は使わず、形で状態を表す：
/// - 話せます（入力なし）：紺の「・・・」。ごくゆっくり明滅する
/// - 声を受け取り中：緑の縦棒の波形（音量が届く端末では音量に連動）
/// - 処理中：紫の輪が回る
/// - 回答待ち：オレンジの丸に「？」（静止）
/// - 準備中・再開中：薄い「・・・」（静止。受付可能とは見せない）
/// - 一時停止：グレーの縦2本の棒（静止）
/// - 使えない：グレーの「・・・」に斜線（静止）
/// 形は [VoiceModeIndicator.dotSize] 四方の中に収め、タップ範囲は [VoiceModeIndicator.hitSize]。
/// 理由や認識した文は文章でここには出さない（読み上げ・ツールチップと、タップで開くコマンドシートに寄せる）。
class VoiceModeDot extends StatefulWidget {
  final VoiceModeStatus status;
  final VoidCallback? onTap;

  /// 直前の発話をコマンドではないとして聞き流した直後か（形は変えず、読み上げの説明にだけ足す）
  final bool recentlyIgnored;

  /// 声を受け取り中の波形の高さ（0〜1）。null・値なしなら一定のゆらぎ
  final ValueListenable<double?>? level;

  const VoiceModeDot({super.key, required this.status, this.onTap, this.recentlyIgnored = false, this.level});

  static const Color navy = Color(0xFF3949AB);
  static const Color faint = Color(0xFFC5CAE9);

  // NOTE: ダークのバーでは明暗が逆に見える（薄い点のほうが紺より目立ち、準備中が話せますより強く見える）ので、
  // ダークでは「話せます」を明るい藍、「準備中」を暗い藍にして、強弱の関係を保つ
  static const Color navyOnDark = Color(0xFF9FA8DA);
  static const Color faintOnDark = Color(0xFF3C4366);
  static const Color green = Color(0xFF2E9E4F);
  static const Color purple = Color(0xFF9C27B0);
  static const Color orange = Color(0xFFF57C00);
  static const Color grey = Color(0xFF9CA3AF);
  static const Color slashGrey = Color(0xFF6B7280);

  /// 明滅（話せます）の 1 往復の半分。目立たせないよう、ごくゆっくり
  static const Duration breatheHalf = Duration(milliseconds: 2000);

  /// 波形（声を受け取り中）のゆらぎ 1 回分
  static const Duration waveCycle = Duration(milliseconds: 900);

  /// 輪が 1 周する（処理中）時間
  static const Duration spinCycle = Duration(milliseconds: 1600);

  /// 形の主な色（描画確認・テスト用）
  static Color colorOf(VoiceModeStatus status) => switch (status) {
        VoiceModeStatus.ready => navy,
        VoiceModeStatus.hearing => green,
        VoiceModeStatus.processing => purple,
        VoiceModeStatus.awaiting => orange,
        VoiceModeStatus.preparing => faint,
        VoiceModeStatus.paused || VoiceModeStatus.unavailable || VoiceModeStatus.off => grey,
      };

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
      case VoiceModeStatus.hearing:
        _motion.duration = VoiceModeDot.waveCycle;
        _motion.value = 0;
        _motion.repeat();
      case VoiceModeStatus.processing:
        _motion.duration = VoiceModeDot.spinCycle;
        _motion.value = 0;
        _motion.repeat();
      case VoiceModeStatus.awaiting ||
            VoiceModeStatus.preparing ||
            VoiceModeStatus.unavailable ||
            VoiceModeStatus.paused ||
            VoiceModeStatus.off:
        _motion.value = 0;
    }
  }

  Widget _glyph() {
    const size = VoiceModeIndicator.dotSize;
    final dark = Theme.of(context).brightness == Brightness.dark;
    switch (widget.status) {
      case VoiceModeStatus.ready:
        // ごくゆっくり明滅（不透明度 1.0 ⇄ 0.55）。消えたように見えるほどは暗くしない
        return FadeTransition(
          key: const ValueKey('voice-mode-breathe'),
          opacity: _motion.drive(Tween(begin: 1.0, end: 0.55).chain(CurveTween(curve: Curves.easeInOut))),
          child: VoiceDotsGlyph(
            key: const ValueKey('voice-mode-dots'),
            color: dark ? VoiceModeDot.navyOnDark : VoiceModeDot.navy,
          ),
        );
      case VoiceModeStatus.preparing:
        return VoiceDotsGlyph(
          key: const ValueKey('voice-mode-dots'),
          color: dark ? VoiceModeDot.faintOnDark : VoiceModeDot.faint,
        );
      case VoiceModeStatus.hearing:
        return CustomPaint(
          key: const ValueKey('voice-mode-wave'),
          size: const Size.square(size),
          painter: VoiceWavePainter(_motion, widget.level, VoiceModeDot.green),
        );
      case VoiceModeStatus.processing:
        return CustomPaint(
          key: const ValueKey('voice-mode-spin'),
          size: const Size.square(24),
          painter: VoiceSpinPainter(_motion, VoiceModeDot.purple),
        );
      case VoiceModeStatus.awaiting:
        return const VoiceQuestionGlyph(key: ValueKey('voice-mode-question'), color: VoiceModeDot.orange);
      case VoiceModeStatus.paused || VoiceModeStatus.off:
        return const VoicePauseGlyph(key: ValueKey('voice-mode-pause'), color: VoiceModeDot.grey);
      case VoiceModeStatus.unavailable:
        return VoiceSlashedDotsGlyph(
          key: const ValueKey('voice-mode-slash'),
          dotColor: VoiceModeDot.grey,
          // ダークでは濃いグレーの線が背景に沈むので、点と同じ明るさにする
          lineColor: dark ? VoiceModeDot.grey : VoiceModeDot.slashGrey,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.status;
    final label = VoiceModeDot.labelOf(status, recentlyIgnored: widget.recentlyIgnored);
    const size = VoiceModeIndicator.dotSize;
    const hitSize = VoiceModeIndicator.hitSize;

    final glyph = SizedBox.square(
      key: ValueKey('voice-mode-dot-${status.name}'),
      dimension: size,
      child: Center(
        // 状態が変わるときは短く入れ替える（張り直しの合間の「準備中」がちらつきに見えないように）
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: KeyedSubtree(key: ValueKey(status), child: _glyph()),
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
              // 毎フレーム描き直す動き（明滅・波形・回転）を印の中だけに閉じ込め、タイトルバー等まで描き直させない
              child: Center(
                child: RepaintBoundary(key: const ValueKey('voice-mode-lamp-boundary'), child: glyph),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
