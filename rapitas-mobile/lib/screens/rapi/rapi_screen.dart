import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/rapi.dart';
import '../../providers/rapi_chat_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../providers/voice_provider.dart';
import '../../services/compose_requests.dart';
import '../../services/dictation_service.dart';
import '../../widgets/app_drawer.dart';
import '../../widgets/rapi_avatar.dart';
import '../../widgets/rapi_criteria_list.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';
import 'rapi_companion_card.dart';
import 'rapi_roadmap_card.dart';
import 'rapi_tidy_card.dart';

// ラピのチャット画面（デスクトップ rapi-avatar パネルのモバイル移植 v1）。
//
// ラピは汎用チャットボットではなく「ユーザーがやること／ラピがやること」の境界を
// 守るエージェント。モードの切り替えは置かず、送った文は毎回 /assistant/route で
// 振り分ける。扱う振り分け先は 作成（下書きカード）・問い合わせ（回答カード）・
// 見守り（一覧の先頭のカード）・変更（変更カード）・計画（計画カード：rapi_roadmap_card.dart）・
// 片付け（片付けカード：rapi_tidy_card.dart）・相談（タスク選びカード → 相談モード）と、
// 振り分けなしの会話（デスクトップの4モードはすべてスマホでも扱う）。
// 相談モード中は入力欄の上に相談中のタスクの帯を出し、× で抜けられる。
//
// NOTE: 会話の状態と送信処理は rapiChatProvider（providers/rapi_chat_provider.dart）が持つ。
// /rapi は下部タブで、タブを切り替えるとこの画面は破棄されるため。画面に残すのは
// 入力欄の TextEditingController とスクロールだけ。会話はアプリを終了すると消える。
// NOTE: routes.dart は import しない（循環を避けるためパスは文字列で書く）。
// NOTE: 音声入力は入力欄の右のマイクから。聞き取った文を欄に流し込み、聞き取りが
// 終わったら（無音で自動終了／マイクをもう一度押す）欄の文をそのまま送信する
// （送信は文字入力と同じ _chat.send を通す）。聞き取りは dictationServiceProvider の
// ラッパー経由で、画面からは speech_to_text を直接触らない。

/// 入力欄のヒント文
const String _placeholder = 'やりたいことをそのまま書いてください';

/// 相談モード中の入力欄のヒント文
const String _consultPlaceholder = 'このタスクについて相談したいこと';

/// 聞き取り中の入力欄のヒント文
const String _listeningPlaceholder = '聞き取り中…';

// 音声入力で送らなかったときの案内（system メッセージ）
const String _voicePermissionMessage =
    'マイクが使えないため、音声入力できませんでした。設定アプリで rapitas のマイクと音声認識を許可してください。';
const String _voiceUnavailableMessage = 'この端末では音声入力を使えませんでした。';
const String _voiceEmptyMessage = '声を聞き取れなかったので、送信しませんでした。';
const String _voiceFailedMessage = '音声をうまく認識できなかったので、送信しませんでした。';

const Map<String, String> _statusLabels = {
  'todo': '未着手',
  'in-progress': '進行中',
  'in_progress': '進行中',
  'blocked': 'ブロック中',
  'done': '完了',
  'cancelled': '中止',
};

/// バックエンドの free text 上限（assistant-intake.routes.ts MAX_TEXT_LENGTH）
const int _maxTextLength = 2000;

const _indigo = Color(0xFF4F46E5);

/// 聞き取り中のマイクボタンの色
const _listeningRed = Color(0xFFEF4444);
/// 聞くの回答カードの地色
const _bubbleGray = Color(0xFFF4F4F5);
const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);

/// ラピの発言の本文色（デスクトップ RapiAvatarDock.tsx の light 本文色）
const _rapiText = Color(0xFF1F2937);

/// ラピの発言カードの地色と枠
const _rapiCardBg = Color(0xFFFFFFFF);
const _rapiCardBorder = Color(0xFFE4E4E7);

/// 発言どうしの間隔
const double _messageGap = 14;

/// AppBar のタイトルに載せるラピのアバター（土台や円形の切り抜きは付けず、本体をそのまま出す。
/// SVG は背景が透過なので、ページの地色がそのまま見える）。本体の円は直径約40px
const double _titleAvatarSize = 64;

/// 足元の影は本体の箱の下にはみ出して描かれる（assets/rapi_avatar.svg の viewBox 120×134）。
/// 名前と重ならないよう、影の分まで高さを取る
const double _titleAvatarHeight = _titleAvatarSize * 134 / 120;

/// アバターの真下に名前を置くため、この画面の AppBar だけ標準（56）より高くする
/// （アバター約71.5 ＋ 間隔1 ＋ 名前12 ≈ 85 に上下の余白を足す）
const double _rapiToolbarHeight = 92;

/// ドロワーを開く丸いガラス風ボタンの直径（見た目の円）
const double _glassButtonSize = 40;

/// ガラス風ボタンのタップ領域（標準の最小 48×48。円の外側の余白も押せる）
const double _glassButtonTapSize = 48;

/// 静止時の一覧の上端で、バーの下端から先頭の発言までに空ける余白
/// （フェードはバーの下端までで終わるので、この余白の中の発言は薄くならない）
const double _topFade = 16;

/// 一覧の下端の余白（最後の発言と入力欄の間）
const double _listBottomPadding = 16;

class RapiScreen extends ConsumerStatefulWidget {
  /// 入力欄へのフォーカス要求の窓口（ディープリンクとショートカット。テストでは自前のもの）
  final ComposeRequests? composeRequests;

  const RapiScreen({super.key, this.composeRequests});

  @override
  ConsumerState<RapiScreen> createState() => _RapiScreenState();
}

/// 音声入力の段階（starting は権限の確認〜聞き取り開始まで）
enum _VoicePhase { idle, starting, listening }

class _RapiScreenState extends ConsumerState<RapiScreen> {
  late final TextEditingController _input;
  late final TextEditingController _draftTitle;
  final _scroll = ScrollController();

  /// 入力欄のフォーカス。ウィジェットやショートカットから開いたとき、ここに当ててキーボードを出す
  final _inputFocus = FocusNode();
  late final ComposeRequests _compose;

  // ---- 音声入力 ----
  // dispose で ref は使えないので、聞き取りのラッパーは最初に取っておく
  late final DictationService _dictation;
  late final AppLifecycleListener _lifecycle;
  _VoicePhase _voice = _VoicePhase.idle;

  /// 聞き取りごとに増やす。止めた／捨てた聞き取りから遅れて届く結果を無視するため
  int _voiceSession = 0;

  bool get _voiceActive => _voice != _VoicePhase.idle;

  RapiChatNotifier get _chat => ref.read(rapiChatProvider.notifier);

  @override
  void initState() {
    super.initState();
    _dictation = ref.read(dictationServiceProvider);
    // アプリが裏へ回ったら聞き取りを捨てる（iOS の権限ダイアログでも inactive になるので onHide で拾う）
    _lifecycle = AppLifecycleListener(onHide: _cancelVoice);
    // タブ往復で消えないよう、未送信の入力と編集中の下書きタイトルは provider から復元する
    final saved = ref.read(rapiChatProvider);
    _input = TextEditingController(text: saved.input)..addListener(_onInputChanged);
    _draftTitle = TextEditingController(text: saved.draftTitle);
    _compose = widget.composeRequests ?? appComposeRequests;
    _compose.listenable.addListener(_onComposeSignal);
    // コールドスタートでは、ルーターの redirect がこの画面より先に要求を出している
    if (_compose.hasPending) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _onComposeRequested());
    }
    // 戻ってきたときは最新の発言が見える位置から始める
    if (saved.messages.length > 1) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
    }
  }

  @override
  void dispose() {
    // タブ切り替えで画面が破棄されたら、聞き取りを残さない（送信もしない）
    _voiceSession++;
    if (_voiceActive) _dictation.cancel();
    _lifecycle.dispose();
    _compose.listenable.removeListener(_onComposeSignal);
    _inputFocus.dispose();
    _input.removeListener(_onInputChanged);
    _input.dispose();
    _scroll.dispose();
    _draftTitle.dispose();
    super.dispose();
  }

  void _onInputChanged() => _chat.setInput(_input.text);

  /// 要求はルーターの redirect の途中で届くので、その場では触らず次のフレームで処理する
  void _onComposeSignal() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _onComposeRequested());
    WidgetsBinding.instance.scheduleFrame();
  }

  /// 入力欄へのフォーカス要求を受け取る。聞き取り中は欄が読み取り専用なので、聞き取りを捨ててから当てる
  void _onComposeRequested() {
    if (!mounted || !_compose.take()) return;
    _cancelVoice();
    // 文の末尾にカーソルを置く（預かった依頼が入っていれば、そのまま書き足せる）
    _input.selection = TextSelection.collapsed(offset: _input.text.length);
    _inputFocus.requestFocus();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  /// provider 側の変化のうち、画面固有の副作用が要るものを拾う
  void _onChatChanged(RapiChatState? prev, RapiChatState next) {
    // 発言が足されたら末尾へスクロールする（足されるときは必ず新しい id が末尾に付く）
    final prevLast = prev?.messages.lastOrNull?.id ?? -1;
    final nextLast = next.messages.lastOrNull?.id ?? -1;
    if (nextLast > prevLast) _scrollToEnd();

    // provider が文を書き換えたとき（送信で空にする・失敗で戻す・新しい下書き）だけ欄へ反映する。
    // 画面での入力は _onInputChanged で provider へ書き戻しているので、ここでは一致する
    if (_input.text != next.input) _input.text = next.input;
    if (_draftTitle.text != next.draftTitle) _draftTitle.text = next.draftTitle;
  }

  void _openTask(String id) {
    _cancelVoice();
    context.push('/tasks/$id');
  }

  void _openTaskList() {
    _cancelVoice();
    context.go('/tasks');
  }

  // ---- 音声入力 ----

  /// マイクボタン：止まっていれば聞き取りを始め、聞き取り中なら終える（終わると送信へ進む）
  Future<void> _onMicPressed() async {
    if (_voice == _VoicePhase.listening) {
      // 確定した結果のあと onEnd が呼ばれ、そこで送信する
      _dictation.stop();
      return;
    }
    if (_voice == _VoicePhase.starting || ref.read(rapiChatProvider).sending) return;

    final session = ++_voiceSession;
    FocusScope.of(context).unfocus();
    setState(() => _voice = _VoicePhase.starting);
    DictationStartFailure? failure;
    try {
      failure = await _dictation.start(
        onWords: (words) => _onVoiceWords(session, words),
        onEnd: (end) => _onVoiceEnd(session, end),
      );
    } catch (_) {
      // NOTE: 開始処理が例外を投げても starting のまま固めない（欄が読み取り専用・マイク無反応になる）。
      // 聞き取りの残りを捨て、「使えない」として案内する
      if (!mounted || session != _voiceSession) return;
      _voiceSession++;
      _dictation.cancel().catchError((_) {});
      setState(() => _voice = _VoicePhase.idle);
      _chat.notice(_voiceUnavailableMessage);
      return;
    }
    if (!mounted || session != _voiceSession) return;
    if (failure != null) {
      setState(() => _voice = _VoicePhase.idle);
      _chat.notice(failure == DictationStartFailure.permissionDenied
          ? _voicePermissionMessage
          : _voiceUnavailableMessage);
      return;
    }
    if (_voice == _VoicePhase.starting) setState(() => _voice = _VoicePhase.listening);
  }

  /// 途中経過も含めて、聞き取った全文で入力欄を置き換える（2000字で切る）
  void _onVoiceWords(int session, String words) {
    if (!mounted || session != _voiceSession) return;
    final text = words.length > _maxTextLength ? words.substring(0, _maxTextLength) : words;
    _input.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }

  /// 聞き取りが普通に終わり、欄に文があればそのまま送る。空・無音・失敗なら送らずに理由を出す
  void _onVoiceEnd(int session, DictationEnd end) {
    if (!mounted || session != _voiceSession) return;
    // 終わった聞き取りから遅れて結果が届いても、送信で空にした欄へ書き戻さない
    _voiceSession++;
    setState(() => _voice = _VoicePhase.idle);
    // 自動で送るのは普通に終わったときだけ。失敗・無音（no_match / speech_timeout）では送らない。
    // どちらも途中まで聞き取れた文は欄に残す（確かめて手で送れる）
    if (end == DictationEnd.failed) {
      _chat.notice(_voiceFailedMessage);
      return;
    }
    if (end == DictationEnd.noSpeech) {
      _chat.notice(_voiceEmptyMessage);
      return;
    }
    if (_input.text.trim().isEmpty) {
      _chat.notice(_voiceEmptyMessage);
      return;
    }
    _chat.send();
  }

  /// 聞き取りを捨てる（送信しない）。画面遷移・ドロワー・アプリが裏へ回ったとき
  void _cancelVoice() {
    if (!_voiceActive) return;
    _voiceSession++;
    _dictation.cancel();
    if (mounted) setState(() => _voice = _VoicePhase.idle);
  }

  // ---- 表示 ----

  @override
  Widget build(BuildContext context) {
    // ラピ本人は AppBar のタイトル位置（アバター＋その真下の名前）の1か所だけに出し、
    // 発言ごとにはアバターを付けない。挨拶も普通のラピの発言として並べる
    final chat = ref.watch(rapiChatProvider);
    ref.listen(rapiChatProvider, _onChatChanged);
    // 上に別の画面が積まれたら聞き取りを止める（build 中は setState できないので次のフレームで）
    if (_voiceActive && !(ModalRoute.of(context)?.isCurrent ?? true)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _cancelVoice());
    }
    final items = <Widget>[
      if (chat.surveyVisible) _buildSurveyCard(context, chat),
      for (final m in chat.messages) _buildMessage(context, chat, m),
      if (chat.sending) const _ThinkingRow(),
    ];

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      drawer: const AppDrawer(),
      // ドロワーを開いたら聞き取りを止める（そのまま別の画面へ移ることが多い）
      onDrawerChanged: (opened) {
        if (opened) _cancelVoice();
      },
      // 本文をバーの裏側まで伸ばす。上へ流れた発言は、ラピとガラス風ボタンの裏を透けて見えながら流れる
      // （バーは本文より手前に重なるので、ボタンとラピのタップはこれまでどおり効く）
      extendBodyBehindAppBar: true,
      // 会話エリアを広く取るため、ラピはヒーローではなくタイトル欄に置く。
      // この画面ではバーの帯に見せないよう、AppBar を完全に透明にし、
      // ラピとガラス風ボタンだけが浮いて見えるようにする（スクロール時の色付き・影も消す）
      appBar: AppBar(
        centerTitle: true,
        toolbarHeight: _rapiToolbarHeight,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        // 地色が透明だと AppBar は「暗い背景」と推定して白い時計・電池を出すため、
        // ページの明るさに合わせて明示する（ステータスバー自体は透明のまま）
        systemOverlayStyle: (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
            .copyWith(statusBarColor: Colors.transparent),
        leading: const _GlassMenuButton(),
        title: const _RapiTitle(),
        // 音声操作モードの聞き取り表示（アプリの操作。モードがオフなら出ない）。右端に置き、
        // 丸の中心は左のガラスのボタンと左右対称（画面端から 28px）。中央のラピとは離れている。
        // 入力欄のマイク（ラピへの発話）とは役割が違い、マイクが動いている間は常時聞き取りが止まる
        actions: const [VoiceModeIndicator()],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: VoiceScrollTarget(
                    path: '/rapi',
                    // extendBodyBehindAppBar の本文では、MediaQuery の上の余白が
                    // 「ステータスバー＋バーの高さ」になる（＝バーの下端の位置）
                    child: Builder(builder: (context) {
                      final barBottom = MediaQuery.paddingOf(context).top;
                      return GestureDetector(
                        onTap: () => FocusScope.of(context).unfocus(),
                        // 上へ流れた発言がぶつ切りに見えないよう、画面の最上部で透明、
                        // バーの下端で通常の濃さになるようにフェードさせる（バーの裏を通る範囲も含む）
                        child: ShaderMask(
                          blendMode: BlendMode.dstIn,
                          shaderCallback: (rect) => LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: const [Colors.transparent, Colors.black],
                            stops: [
                              0,
                              rect.height == 0 ? 0 : (barBottom / rect.height).clamp(0.0, 1.0),
                            ],
                          ).createShader(rect),
                          child: ListView(
                            controller: _scroll,
                            // 静止時に先頭の発言がラピに隠れないよう、バーの下端＋余白から並べ始める
                            padding: EdgeInsets.fromLTRB(16, barBottom + _topFade, 16, _listBottomPadding),
                            children: items,
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ],
            ),
          ),
          if (chat.consultTask case final consult?)
            _ConsultBand(
              key: const ValueKey('rapi-consult-band'),
              title: consult.title,
              onOpen: () => _openTask(consult.id),
              onExit: _chat.exitConsult,
            ),
          _Composer(
            controller: _input,
            focusNode: _inputFocus,
            placeholder: _voiceActive
                ? _listeningPlaceholder
                : chat.consultTask != null
                    ? _consultPlaceholder
                    : _placeholder,
            hasText: chat.input.trim().isNotEmpty,
            sending: chat.sending,
            listening: _voiceActive,
            onSend: _chat.send,
            onMic: _onMicPressed,
          ),
        ],
      ),
    );
  }

  Widget _buildMessage(BuildContext context, RapiChatState chat, RapiMessage m) {
    if (m.draftSlot) {
      final draft = chat.draft;
      if (draft == null) return const SizedBox.shrink();
      return _spaced(_buildDraftCard(context, chat, draft));
    }
    final answer = m.answer;
    if (answer != null) {
      return _spaced(_AskAnswerCard(answer: answer, onOpen: _openTask));
    }
    final change = m.change;
    if (change != null) {
      return _spaced(_ChangeCard(
        key: ValueKey('rapi-change-${m.id}'),
        card: change,
        onApply: () => _chat.applyChange(m.id),
        onCancel: () => _chat.cancelChange(m.id),
        onRevert: () => _chat.revertChange(m.id),
        onOpen: () => _openTask(change.proposal.taskId),
      ));
    }

    final roadmap = m.roadmap;
    if (roadmap != null) {
      return _spaced(RapiRoadmapCardView(
        key: ValueKey('rapi-roadmap-${m.id}'),
        card: roadmap,
        onAnswer: (i, answer) => _chat.chooseRoadmapAnswer(m.id, i, answer),
        onRefine: () => _chat.refineRoadmap(m.id),
        onCommit: () => _chat.commitRoadmap(m.id),
        onToggleCriterion: (step, i) => _chat.toggleRoadmapCriterion(m.id, step, i),
        onEditCriterion: (step, i, text) => _chat.editRoadmapCriterion(m.id, step, i, text),
        onCancel: () => _chat.cancelRoadmap(m.id),
        onOpenTasks: _openTaskList,
      ));
    }

    final tidy = m.tidy;
    if (tidy != null) {
      return _spaced(RapiTidyCardView(
        key: ValueKey('rapi-tidy-${m.id}'),
        card: tidy,
        onHow: (how) => _chat.setTidyHow(m.id, how),
        onTheme: (themeId) => _chat.setTidyTheme(m.id, themeId),
        onStatus: (status) => _chat.toggleTidyStatus(m.id, status),
        onDays: (days) => _chat.setTidyDays(m.id, days),
        onSearch: () => _chat.searchTidy(m.id),
        onToggle: (taskId) => _chat.toggleTidyItem(m.id, taskId),
        onAll: (selected) => _chat.setTidyAll(m.id, selected),
        onExpand: () => _chat.expandTidy(m.id),
        onBack: () => _chat.backToTidySetup(m.id),
        onCancel: () => _chat.cancelTidy(m.id),
        onDelete: () => _chat.deleteTidy(m.id),
        onRestore: (trashId) => _chat.restoreTidy(m.id, trashId),
        onRestoreAll: () => _chat.restoreAllTidy(m.id),
        onOpenTasks: _openTaskList,
      ));
    }

    final companion = m.companion;
    if (companion != null) {
      return _spaced(RapiCompanionCardView(
        key: ValueKey('rapi-companion-${m.id}'),
        card: companion,
        onApply: () => _chat.applyCompanion(m.id),
        onCancel: () => _chat.cancelCompanion(m.id),
        onOpen: () => _openTask(companion.proposal.taskId),
      ));
    }

    final picker = m.consultPicker;
    if (picker != null) {
      return _spaced(_ConsultPickerCard(
        key: ValueKey('rapi-consult-picker-${m.id}'),
        picker: picker,
        busy: chat.sending,
        onChoose: (task) => _chat.chooseConsultTask(m.id, task),
        onDismiss: () => _chat.dismissConsultPicker(m.id),
        // 一覧が届くとカードの背が伸びる。カードが末尾なら、伸びた分まで見せる
        onListLoaded: () {
          if (ref.read(rapiChatProvider).messages.lastOrNull?.id == m.id) _scrollToEnd();
        },
      ));
    }

    switch (m.role) {
      case RapiRole.user:
        return _spaced(_UserMessage(text: m.text));
      case RapiRole.assistant:
        return _spaced(_RapiMessage(text: m.text));
      case RapiRole.system:
        final taskId = m.taskId;
        final draftId = m.externalDraftId;
        return _spaced(_SystemNote(
          text: m.text,
          onOpen: taskId == null ? null : () => _openTask(taskId),
          // 欄に入っているショートカットの依頼の案内にだけ出す（送った・破棄した依頼の案内には出さない）
          onDiscard: draftId != null && draftId == chat.activeExternalDraftId && !chat.sending
              ? _chat.discardExternalDraft
              : null,
        ));
    }
  }

  Widget _spaced(Widget child) =>
      Padding(padding: const EdgeInsets.only(bottom: _messageGap), child: child);

  Widget _buildDraftCard(BuildContext context, RapiChatState chat, TaskDraft draft) {
    // テーマの選択肢：下書きの候補 → 無ければテーマ一覧
    var options = draft.themeCandidates;
    if (options.isEmpty) {
      final themes = ref.watch(themeListProvider).valueOrNull ?? const [];
      options = [for (final t in themes) RapiThemeRef(id: t.id, name: t.name)];
    }
    final selected =
        options.any((t) => t.id == chat.draftThemeId) ? chat.draftThemeId : null;
    final canCreate = selected != null &&
        chat.draftTitle.trim().isNotEmpty &&
        !chat.creating &&
        chat.draftSelectedCriteria.isNotEmpty;

    final textTheme = Theme.of(context).textTheme;
    const labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
    const bodyColor = Color(0xFF18181B);

    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 72, child: Text(label, style: labelStyle)),
              Expanded(
                child: Text(value,
                    style: const TextStyle(fontSize: 13, color: bodyColor)),
              ),
            ],
          ),
        );

    return Container(
      decoration: BoxDecoration(
        color: _violetBg,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('この内容で起票しますか',
              style: textTheme.labelLarge?.copyWith(
                  color: _violetButton, fontWeight: FontWeight.w600)),
          if (draft.fellBackToPatterns)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'うまく読み取れなかったので、書き方のパターンから推定しました。内容をよく確認してください。',
                style: TextStyle(fontSize: 12, color: Color(0xFFB45309)),
              ),
            ),
          const SizedBox(height: 10),
          TextField(
            controller: _draftTitle,
            onChanged: _chat.setDraftTitle,
            style: const TextStyle(fontSize: 15, color: bodyColor),
            decoration: _fieldDecoration('タイトル'),
          ),
          const SizedBox(height: 10),
          // NOTE: DropdownButtonFormField.value は非推奨なので、既存画面と同じく
          // InputDecorator + DropdownButton で組む（選択値は状態から毎回渡す）
          InputDecorator(
            decoration: _fieldDecoration('テーマ').copyWith(
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: selected,
                isExpanded: true,
                dropdownColor: Colors.white,
                // NOTE: テーマの文字設定から作る。fontFamily の無い TextStyle を渡すと、
                // DropdownButton は継承した文字設定を丸ごと置き換える（キャプチャで豆腐になった）
                style: textTheme.bodyMedium?.copyWith(fontSize: 14, color: bodyColor) ??
                    const TextStyle(fontSize: 14, color: bodyColor),
                hint: const Text('テーマを選んでください',
                    style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF))),
                items: [
                  for (final t in options)
                    DropdownMenuItem<String>(
                      value: t.id,
                      child: Text(t.name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: chat.creating ? null : _chat.setDraftTheme,
              ),
            ),
          ),
          if (draft.themeReason != null && selected == draft.themeId)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 4),
              child: Text(draft.themeReason!, style: labelStyle),
            ),
          const SizedBox(height: 4),
          row('優先度', rapiPriorityLabels[draft.priority] ?? '未設定'),
          row('期限', _formatDue(draft.dueDate) ?? '未設定'),
          row('見積もり',
              draft.estimatedHours != null ? '${_formatHours(draft.estimatedHours!)}時間' : '未設定'),
          if (draft.description != null && draft.description != draft.title)
            row('説明', draft.description!),
          if (chat.draftCriteria.items.isNotEmpty) ...[
            const SizedBox(height: 8),
            // 段B：1件ずつ採否・文言・判定者・言い換えの案、下に採点
            RapiCriteriaList(
              edit: chat.draftCriteria,
              onToggle: chat.creating ? null : _chat.toggleDraftCriterion,
              onEdit: chat.creating ? null : _chat.editDraftCriterion,
            ),
          ],
          if (draft.unclear.isNotEmpty) ...[
            const SizedBox(height: 8),
            const Text('ラピが判断できなかったこと', style: labelStyle),
            for (final u in draft.unclear)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text('・$u',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
              ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: _violetButton,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
                    disabledForegroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: canCreate ? _chat.createFromDraft : null,
                  child: Text(chat.creating ? '起票しています…' : 'この内容で作成'),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
                onPressed: chat.creating ? null : _chat.discardDraft,
                child: const Text('やめる'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  InputDecoration _fieldDecoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF6B7280)),
        isDense: true,
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: _violetBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: _violetBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: _violetButton, width: 1.5),
        ),
      );

  Widget _buildSurveyCard(BuildContext context, RapiChatState chat) {
    final scheme = Theme.of(context).colorScheme;
    final survey = chat.survey;
    final muted = TextStyle(fontSize: 12, color: scheme.onSurfaceVariant);

    final children = <Widget>[
      Row(
        children: [
          const Expanded(
            child: Text('手当てが要るもの',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          ),
          TextButton.icon(
            onPressed: chat.surveyLoading ? null : _chat.loadSurvey,
            icon: chat.surveyLoading
                ? const SizedBox(
                    width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh, size: 18),
            label: Text(chat.surveyLoading ? '見ています…' : 'もう一度見る'),
          ),
        ],
      ),
    ];

    if (chat.surveyFailed) {
      children.add(Text('見に行けませんでした。', style: TextStyle(fontSize: 13, color: scheme.error)));
    } else if (survey != null) {
      children.add(Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(
          survey.total == 0
              ? '手当てが要るものは特にありません。'
              : '手当てが要るものは ${survey.total} 件です。',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ));
      for (final finding in survey.needing) {
        children.add(const SizedBox(height: 8));
        children.add(Container(
          decoration: BoxDecoration(
            border: Border.all(color: scheme.outlineVariant),
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(finding.label,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                  Text('${finding.total}', style: muted),
                ],
              ),
              if (finding.reason != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2, bottom: 4),
                  child: Text(finding.reason!, style: muted),
                ),
              for (final task in finding.tasks)
                InkWell(
                  onTap: () => _openTask(task.id),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(task.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 14)),
                        ),
                        if (task.daysWaiting() != null)
                          Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: Text('${task.daysWaiting()}日', style: muted),
                          ),
                        Icon(Icons.chevron_right, size: 18, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ),
                ),
              if (finding.total > finding.tasks.length)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text('うち${finding.tasks.length}件を表示', style: muted),
                ),
            ],
          ),
        ));
      }
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.fromLTRB(14, 6, 6, 12),
        child: Padding(
          padding: const EdgeInsets.only(right: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      ),
    );
  }
}

String? _formatDue(String? iso) {
  if (iso == null) return null;
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return iso;
  return '${d.year}/${d.month.toString().padLeft(2, '0')}/${d.day.toString().padLeft(2, '0')}';
}

String _formatHours(double h) =>
    h == h.roundToDouble() ? h.toInt().toString() : h.toString();

// ---- 部品 ----

/// AppBar のタイトル：ラピ本体（足元の影ごと）と、その真下に小さく名前
class _RapiTitle extends StatelessWidget {
  const _RapiTitle();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 本体を足元の影ごとそのまま出す（土台・円形の切り抜きなし）
        const SizedBox(
          width: _titleAvatarSize,
          height: _titleAvatarHeight,
          child: Align(
            alignment: Alignment.topCenter,
            child: RapiAvatar(size: _titleAvatarSize),
          ),
        ),
        const SizedBox(height: 1),
        Text(
          'ラピ',
          maxLines: 1,
          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, height: 1.2, color: muted),
        ),
      ],
    );
  }
}

/// この画面の AppBar の leading：ドロワーを開く丸いガラス風ボタン
/// （半透明の白の円＋明るい白の細い縁＋ごく薄い影の上に ☰）。動作は標準のハンバーガーと同じ。
/// 見た目の円は直径40だが、IconButton の padded タップ領域で 48×48 を押せるようにする
/// （余白へのタップは円に回され、波紋は円の中に出る）
class _GlassMenuButton extends StatelessWidget {
  const _GlassMenuButton();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SizedBox.square(
        dimension: _glassButtonTapSize,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // ごく薄い影は円の大きさ（40）に合わせて下に敷く
            const DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Color(0x0F000000), // 黒 α0.06
                    blurRadius: 8,
                    offset: Offset(0, 2),
                  ),
                ],
              ),
              child: SizedBox.square(dimension: _glassButtonSize),
            ),
            IconButton(
              tooltip: MaterialLocalizations.of(context).openAppDrawerTooltip,
              onPressed: () => Scaffold.of(context).openDrawer(),
              icon: const Icon(Icons.menu),
              style: IconButton.styleFrom(
                backgroundColor: Colors.white.withValues(alpha: 0.55),
                foregroundColor: _rapiText,
                side: BorderSide(color: Colors.white.withValues(alpha: 0.9)),
                shape: const CircleBorder(),
                iconSize: 20,
                padding: EdgeInsets.zero,
                fixedSize: const Size.square(_glassButtonSize),
                minimumSize: const Size.square(_glassButtonSize),
                maximumSize: const Size.square(_glassButtonSize),
                tapTargetSize: MaterialTapTargetSize.padded,
                visualDensity: VisualDensity.standard,
                elevation: 0,
                shadowColor: Colors.transparent,
                surfaceTintColor: Colors.transparent,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// ユーザーの発言：尻尾のない角丸の塊を右寄せ（藍色）
class _UserMessage extends StatelessWidget {
  final String text;

  const _UserMessage({required this.text});

  @override
  Widget build(BuildContext context) {
    final maxWidth = MediaQuery.sizeOf(context).width * 0.8;
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: _indigo,
            borderRadius: BorderRadius.circular(16),
          ),
          child: SelectableText(
            text,
            style: const TextStyle(fontSize: 15, height: 1.45, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

/// ラピの発言を載せる白いカード（全幅・尻尾なし・アバターなし。左右の余白は一覧の 16）
class _RapiCard extends StatelessWidget {
  final Widget child;

  const _RapiCard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: _rapiCardBg,
        border: Border.all(color: _rapiCardBorder),
        borderRadius: BorderRadius.circular(16),
      ),
      child: child,
    );
  }
}

/// ラピの発言：全幅の白いカードに本文
class _RapiMessage extends StatelessWidget {
  final String text;

  const _RapiMessage({required this.text});

  @override
  Widget build(BuildContext context) {
    return _RapiCard(
      child: SelectableText(
        text,
        style: const TextStyle(fontSize: 15, height: 1.6, color: _rapiText),
      ),
    );
  }
}

/// 送信中の行：ラピの発言と同じ白いカードに、小さなスピナー＋「考え中…」
class _ThinkingRow extends StatelessWidget {
  const _ThinkingRow();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.only(bottom: _messageGap),
      child: _RapiCard(
        child: Row(
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF8B5CF6)),
            ),
            const SizedBox(width: 8),
            Text('考え中…', style: TextStyle(fontSize: 14, color: muted)),
          ],
        ),
      ),
    );
  }
}

class _SystemNote extends StatelessWidget {
  final String text;
  final VoidCallback? onOpen;

  /// ショートカットから届いた依頼を破棄する（欄に入れた依頼の案内のときだけ）
  final VoidCallback? onDiscard;

  const _SystemNote({required this.text, this.onOpen, this.onDiscard});

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(text,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: color, height: 1.4)),
            if (onOpen != null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: _violetButton,
                  visualDensity: VisualDensity.compact,
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                onPressed: onOpen,
                child: const Text('開く'),
              ),
            if (onDiscard != null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFF6B7280),
                  visualDensity: VisualDensity.compact,
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                onPressed: onDiscard,
                child: const Text('この依頼を破棄'),
              ),
          ],
        ),
      ),
    );
  }
}

class _AskAnswerCard extends StatelessWidget {
  final AskAnswer answer;
  final ValueChanged<String> onOpen;

  const _AskAnswerCard({required this.answer, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    const muted = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
    const body = Color(0xFF18181B);
    final children = <Widget>[];
    if (!answer.available) {
      children.add(const Text('うまく読み取れませんでした。言い方を変えてみてください。',
          style: TextStyle(fontSize: 15, color: body, height: 1.45)));
    } else {
      children.add(Text(
        answer.total == 0 ? '該当するタスクはありませんでした' : '${answer.total}件 見つかりました',
        style: const TextStyle(fontSize: 15, color: body, fontWeight: FontWeight.w600),
      ));
      for (final row in answer.rows) {
        final meta = [
          _statusLabels[row.status] ?? row.status,
          if (rapiPriorityLabels[row.priority] != null) '優先度 ${rapiPriorityLabels[row.priority]}',
          if (row.dueDate != null) '期限 ${_formatDue(row.dueDate!.toIso8601String())}',
        ].where((s) => s.isNotEmpty).join(' · ');
        children.add(InkWell(
          onTap: () => onOpen(row.id),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(row.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, color: body)),
                      if (meta.isNotEmpty) Text(meta, style: muted),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, size: 18, color: Color(0xFF9CA3AF)),
              ],
            ),
          ),
        ));
      }
      if (answer.total > answer.rows.length) {
        children.add(Text('うち${answer.rows.length}件を表示', style: muted));
      }
    }
    if (answer.unclear.isNotEmpty) {
      children.add(const SizedBox(height: 6));
      children.add(const Text('ラピが判断できなかったこと', style: muted));
      for (final u in answer.unclear) {
        children.add(Text('・$u', style: muted));
      }
    }

    // カード単体で全幅（下書きカードと同じ）。左にラピは置かない
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      decoration: BoxDecoration(
        color: _bubbleGray,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }
}

/// 変更（change）カード：対象タスク、項目ごとの「今 → 変更後」、理由と、
/// 「適用する」「やめる」（確認待ち）／「取り消す」（適用後）。見た目は下書きカードにそろえる。
///
/// NOTE: update-draft の提案は新しい値だけを持つので、確認待ちの「今」の値は
/// GET /tasks/:id（taskDetailProvider）から出す（読めない間は変更後の値だけ）。
/// 適用後は task-update が返した before / after（実際に変わった項目だけ）を出す。
class _ChangeCard extends ConsumerWidget {
  final RapiChangeCard card;
  final VoidCallback onApply;
  final VoidCallback onCancel;
  final VoidCallback onRevert;
  final VoidCallback onOpen;

  const _ChangeCard({
    super.key,
    required this.card,
    required this.onApply,
    required this.onCancel,
    required this.onRevert,
    required this.onOpen,
  });

  static const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
  static const _bodyColor = Color(0xFF18181B);
  static const _doneGreen = Color(0xFF047857);
  static const _warnAmber = Color(0xFFB45309);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final proposal = card.proposal;
    final themes = ref.watch(themeListProvider).valueOrNull ?? const [];
    final phase = card.phase;
    final proposed = phase == RapiChangePhase.proposed || phase == RapiChangePhase.applying;

    // 確認待ちの「今」の値（読めた分だけ）
    final current = proposed
        ? ref.watch(taskDetailProvider(proposal.taskId)).valueOrNull
        : null;

    String show(String field, Object? value) {
      if (value == null) return 'なし';
      switch (field) {
        case 'status':
          return rapiChangeStatusLabels[value] ?? _statusLabels[value] ?? '$value';
        case 'priority':
          return rapiPriorityLabels[value] ?? '$value';
        case 'themeId':
          final id = '$value';
          for (final t in themes) {
            if (t.id == id) return t.name;
          }
          if (current?.theme != null && current!.theme!.id == id) return current.theme!.name;
          return 'テーマ#$id';
        case 'dueDate':
          final v = '$value';
          return v.length >= 10 && v[4] == '-' ? v.substring(0, 10).replaceAll('-', '/') : v;
      }
      return '$value';
    }

    Object? currentValue(String field) {
      final t = current;
      if (t == null) return _unknown;
      switch (field) {
        case 'status':
          return t.status;
        case 'priority':
          return t.priority;
        case 'themeId':
          return t.themeId;
        case 'dueDate':
          final d = t.dueDate?.toUtc();
          return d == null
              ? null
              : '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      }
      return _unknown;
    }

    // 並べる行：確認待ちは提案の項目、適用後は実際に変わった項目
    final result = card.result;
    final List<(String, Object?, Object?)> rows;
    if (!proposed && result != null && result.after.isNotEmpty) {
      rows = [
        for (final f in rapiChangeFields)
          if (result.after.containsKey(f)) (f, result.before[f], result.after[f]),
      ];
    } else {
      rows = [
        for (final f in proposal.changes.fields)
          (f, currentValue(f), proposal.changes.values[f]),
      ];
    }

    Widget row((String, Object?, Object?) r) {
      final (field, before, after) = r;
      return Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
                width: 72, child: Text(rapiChangeFieldLabels[field] ?? field, style: _labelStyle)),
            Expanded(
              child: Text.rich(
                TextSpan(children: [
                  if (!identical(before, _unknown)) ...[
                    TextSpan(
                        text: show(field, before),
                        style: const TextStyle(color: Color(0xFF6B7280))),
                    const TextSpan(text: '  →  ', style: TextStyle(color: Color(0xFF9CA3AF))),
                  ],
                  TextSpan(
                      text: show(field, after),
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ]),
                style: const TextStyle(fontSize: 13, color: _bodyColor),
              ),
            ),
          ],
        ),
      );
    }

    final String heading = switch (phase) {
      RapiChangePhase.proposed || RapiChangePhase.applying => 'この内容で変更しますか',
      RapiChangePhase.applied || RapiChangePhase.reverting => '変更しました',
      RapiChangePhase.reverted => '元に戻しました',
      RapiChangePhase.applyUnknown => '変更できたか確かめられませんでした',
      RapiChangePhase.revertUnavailable => '取り消せる記録がありません',
    };
    final IconData headingIcon = switch (phase) {
      RapiChangePhase.reverted => Icons.undo,
      RapiChangePhase.applyUnknown => Icons.help_outline,
      RapiChangePhase.revertUnavailable => Icons.info_outline,
      _ => Icons.check_circle,
    };
    final headingColor = phase == RapiChangePhase.applyUnknown ? _warnAmber : _violetButton;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      decoration: BoxDecoration(
        color: _violetBg,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (!proposed)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(headingIcon, size: 16, color: headingColor),
                ),
              Expanded(
                child: Text(heading,
                    style: textTheme.labelLarge
                        ?.copyWith(color: headingColor, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text('対象', style: _labelStyle),
          const SizedBox(height: 2),
          Text(proposal.title,
              style: const TextStyle(
                  fontSize: 15, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          const SizedBox(height: 2),
          for (final r in rows) row(r),
          if (proposed && proposal.reason.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(proposal.reason, style: _labelStyle),
            ),
          if (proposed && card.considered > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('最近更新された${card.considered}件の中から選びました',
                  style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
            ),
          if (phase == RapiChangePhase.reverted)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('変更前の内容に戻しました。',
                  style: TextStyle(fontSize: 12, color: _doneGreen)),
            ),
          if (phase == RapiChangePhase.applyUnknown)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                '応答がなく、この変更が反映されたか確かめられませんでした。反映済みの場合もあるため、'
                'ここからは適用し直せません。タスクを開いて今の内容を確かめてください。',
                style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
              ),
            ),
          if (phase == RapiChangePhase.revertUnavailable)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                '既に取り消し済みの可能性があります。今の内容はタスクを開いて確かめてください。',
                style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
              ),
            ),
          if (card.conflicts.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'その後に${card.conflicts.map((f) => '「${rapiChangeFieldLabels[f] ?? f}」').join('')}が'
                '変更されたため、元に戻せませんでした。今の内容はタスクを開いて確かめてください。',
                style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
              ),
            ),
          if (card.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(card.error!,
                  style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
            ),
          const SizedBox(height: 12),
          if (proposed)
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: _violetButton,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
                      disabledForegroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: phase == RapiChangePhase.applying ? null : onApply,
                    child: Text(phase == RapiChangePhase.applying ? '変更しています…' : '適用する'),
                  ),
                ),
                const SizedBox(width: 8),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
                  onPressed: phase == RapiChangePhase.applying ? null : onCancel,
                  child: const Text('やめる'),
                ),
              ],
            )
          else
            Row(
              children: [
                if (card.canRevert || phase == RapiChangePhase.reverting)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _violetButton,
                      side: const BorderSide(color: _violetBorder),
                      backgroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: card.canRevert ? onRevert : null,
                    icon: const Icon(Icons.undo, size: 18),
                    label: Text(phase == RapiChangePhase.reverting ? '元に戻しています…' : '取り消す'),
                  ),
                const Spacer(),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: _violetButton),
                  onPressed: onOpen,
                  child: const Text('タスクを開く'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// 「今」の値をまだ読めていない印（null は「なし」の意味で使うので別にする）
const Object _unknown = Object();

/// 相談のタスク選びカード：「どのタスクについて相談しますか」と、保留している発言、
/// 最近更新されたタスクの一覧（タップで選ぶ）、「やめる」。見た目は下書きカードにそろえる。
/// 選んだあと・閉じたあとは1行の控えだけ残す。
class _ConsultPickerCard extends ConsumerWidget {
  final RapiConsultPicker picker;

  /// 送信中は選べない（保留中の発言と順番が入れ替わらないように）
  final bool busy;
  final ValueChanged<RapiConsultTask> onChoose;
  final VoidCallback onDismiss;
  final VoidCallback onListLoaded;

  const _ConsultPickerCard({
    super.key,
    required this.picker,
    required this.busy,
    required this.onChoose,
    required this.onDismiss,
    required this.onListLoaded,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const muted = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
    const body = Color(0xFF18181B);

    switch (picker.phase) {
      case RapiConsultPickPhase.chosen:
        return _SystemNote(
            text: picker.companion != null
                ? '「${picker.chosen?.title ?? ''}」の伴走について確かめます'
                : '「${picker.chosen?.title ?? ''}」について相談します');
      case RapiConsultPickPhase.closed:
        return const _SystemNote(text: 'タスクを選ばずに閉じました（この発言は送っていません）');
      case RapiConsultPickPhase.choosing:
        break;
    }

    final tasks = ref.watch(taskListProvider(const TaskFilter()));
    ref.listen(taskListProvider(const TaskFilter()), (prev, next) {
      if (next.hasValue && !(prev?.hasValue ?? false)) onListLoaded();
    });
    final Widget list = tasks.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: _violetButton),
          ),
        ),
      ),
      error: (_, __) => Row(
        children: [
          const Expanded(child: Text('タスクの一覧を読み込めませんでした', style: muted)),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: _violetButton),
            onPressed: () => ref.invalidate(taskListProvider(const TaskFilter())),
            child: const Text('再読み込み'),
          ),
        ],
      ),
      data: (all) {
        final candidates = rapiConsultCandidates(all);
        if (candidates.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('相談できるタスクがまだありません', style: muted),
          );
        }
        return Column(
          children: [
            for (final t in candidates)
              InkWell(
                key: ValueKey('rapi-consult-task-${t.id}'),
                borderRadius: BorderRadius.circular(8),
                onTap: busy ? null : () => onChoose(RapiConsultTask(id: t.id, title: t.title)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t.title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 14, color: body)),
                            Text(_statusLabels[t.status] ?? t.status, style: muted),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right, size: 18, color: Color(0xFF9CA3AF)),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );

    return Container(
      decoration: BoxDecoration(
        color: _violetBg,
        border: Border.all(color: _violetBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
              switch (picker.companion) {
                RapiCompanionAction.start => 'どのタスクを伴走しますか',
                RapiCompanionAction.stop => 'どのタスクの伴走をやめますか',
                null => 'どのタスクについて相談しますか',
              },
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(color: _violetButton, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(
              picker.companion != null
                  ? '選ぶと確認カードを出します（まだ変更しません）。'
                  : '選ぶと、さっきの発言をそのタスクへの最初の相談として送ります。',
              style: muted),
          const SizedBox(height: 6),
          list,
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const ValueKey('rapi-consult-dismiss'),
              style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
              onPressed: onDismiss,
              child: const Text('やめる'),
            ),
          ),
        ],
      ),
    );
  }
}

/// 相談モード中に入力欄の上へ出す帯：相談中のタスク名（タップで開く）と、抜ける ×
class _ConsultBand extends StatelessWidget {
  final String title;
  final VoidCallback onOpen;
  final VoidCallback onExit;

  const _ConsultBand({
    super.key,
    required this.title,
    required this.onOpen,
    required this.onExit,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Container(
        decoration: BoxDecoration(
          color: _violetBg,
          border: Border.all(color: _violetBorder),
          borderRadius: BorderRadius.circular(20),
        ),
        padding: const EdgeInsets.only(left: 12),
        child: Row(
          children: [
            const Icon(Icons.forum_outlined, size: 16, color: _violetButton),
            const SizedBox(width: 6),
            const Text('相談中',
                style: TextStyle(
                    fontSize: 12, color: _violetButton, fontWeight: FontWeight.w600)),
            const SizedBox(width: 8),
            Expanded(
              child: GestureDetector(
                onTap: onOpen,
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: Color(0xFF18181B)),
                ),
              ),
            ),
            IconButton(
              key: const ValueKey('rapi-consult-exit'),
              tooltip: '相談を終える',
              visualDensity: VisualDensity.compact,
              iconSize: 18,
              color: const Color(0xFF6B7280),
              onPressed: onExit,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }
}

/// 下部のチャット欄（角丸の入力欄＋右端の丸いボタン）。
/// 右端のボタンは1つを出し分ける：聞き取り中は赤いマイク（押すと聞き取りを終えて送信）、
/// 文があれば送信、空ならマイク（押すと聞き取りを始める）
class _Composer extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final String placeholder;
  final bool hasText;
  final bool sending;
  final bool listening;
  final VoidCallback onSend;
  final VoidCallback onMic;

  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.placeholder,
    required this.hasText,
    required this.sending,
    required this.listening,
    required this.onSend,
    required this.onMic,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final Widget button;
    if (listening) {
      button = _RoundButton(
        key: const ValueKey('rapi-mic'),
        tooltip: '聞き取りを終える',
        color: _listeningRed,
        halo: true,
        icon: Icons.mic,
        iconColor: Colors.white,
        onTap: onMic,
      );
    } else if (hasText) {
      final canSend = !sending;
      button = _RoundButton(
        key: const ValueKey('rapi-send'),
        tooltip: '送信',
        color: canSend ? _indigo : scheme.outlineVariant,
        icon: Icons.arrow_upward,
        iconColor: Colors.white,
        onTap: canSend ? onSend : null,
      );
    } else {
      button = _RoundButton(
        key: const ValueKey('rapi-mic'),
        tooltip: '音声で入力',
        color: sending ? scheme.outlineVariant : _indigo.withValues(alpha: 0.1),
        icon: Icons.mic_none,
        iconColor: sending ? Colors.white : _indigo,
        onTap: sending ? null : onMic,
      );
    }

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Container(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: listening ? _listeningRed.withValues(alpha: 0.5) : scheme.outlineVariant),
          ),
          padding: const EdgeInsets.fromLTRB(16, 4, 6, 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('rapi-input'),
                  controller: controller,
                  focusNode: focusNode,
                  // 聞き取り中は認識結果で欄を書き換えるので、手での入力は受けない
                  readOnly: listening,
                  minLines: 1,
                  maxLines: 5,
                  textInputAction: TextInputAction.newline,
                  inputFormatters: [LengthLimitingTextInputFormatter(_maxTextLength)],
                  style: const TextStyle(fontSize: 15),
                  decoration: InputDecoration(
                    hintText: placeholder,
                    hintMaxLines: 1,
                    hintStyle: listening ? const TextStyle(color: _listeningRed) : null,
                    // テーマの filled を切る（角丸の枠の中に灰色の箱が出ないように）
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: button,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 入力欄の右端の丸いボタン（直径40）。[halo] は聞き取り中の淡い輪
class _RoundButton extends StatelessWidget {
  final String tooltip;
  final Color color;
  final IconData icon;
  final Color iconColor;
  final VoidCallback? onTap;
  final bool halo;

  const _RoundButton({
    super.key,
    required this.tooltip,
    required this.color,
    required this.icon,
    required this.iconColor,
    required this.onTap,
    this.halo = false,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: halo
              ? [BoxShadow(color: _listeningRed.withValues(alpha: 0.2), spreadRadius: 3)]
              : null,
        ),
        child: Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 40,
              height: 40,
              child: Icon(icon, color: iconColor, size: 22),
            ),
          ),
        ),
      ),
    );
  }
}
