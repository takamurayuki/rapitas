import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/rapi.dart';
import '../../providers/rapi_chat_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../widgets/app_drawer.dart';
import '../../widgets/rapi_avatar.dart';

// ラピのチャット画面（デスクトップ rapi-avatar パネルのモバイル移植 v1）。
//
// ラピは汎用チャットボットではなく「ユーザーがやること／ラピがやること」の境界を
// 守るエージェント。モードの切り替えは置かず、送った文は毎回 /assistant/route で
// 振り分ける。v1 で扱う振り分け先は 作成（下書きカード）・問い合わせ（回答カード）・
// 見守り（一覧の先頭のカード）と、振り分けなしの会話。それ以外の振り分け先
// （consult/tidy/roadmap/change）は「デスクトップ版で対応」と正直に伝え、会話でごまかさない。
//
// NOTE: 会話の状態と送信処理は rapiChatProvider（providers/rapi_chat_provider.dart）が持つ。
// /rapi は下部タブで、タブを切り替えるとこの画面は破棄されるため。画面に残すのは
// 入力欄の TextEditingController とスクロールだけ。会話はアプリを終了すると消える。
// NOTE: routes.dart は import しない（循環を避けるためパスは文字列で書く）。

/// 入力欄のヒント文
const String _placeholder = 'やりたいことをそのまま書いてください';

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

/// 会話エリア上端のフェードの高さ（一覧の上の余白も同じにして、先頭の発言は薄くならない）
const double _topFade = 16;

class RapiScreen extends ConsumerStatefulWidget {
  const RapiScreen({super.key});

  @override
  ConsumerState<RapiScreen> createState() => _RapiScreenState();
}

class _RapiScreenState extends ConsumerState<RapiScreen> {
  late final TextEditingController _input;
  late final TextEditingController _draftTitle;
  final _scroll = ScrollController();

  RapiChatNotifier get _chat => ref.read(rapiChatProvider.notifier);

  @override
  void initState() {
    super.initState();
    // タブ往復で消えないよう、未送信の入力と編集中の下書きタイトルは provider から復元する
    final saved = ref.read(rapiChatProvider);
    _input = TextEditingController(text: saved.input)..addListener(_onInputChanged);
    _draftTitle = TextEditingController(text: saved.draftTitle);
    // 戻ってきたときは最新の発言が見える位置から始める
    if (saved.messages.length > 1) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
    }
  }

  @override
  void dispose() {
    _input.removeListener(_onInputChanged);
    _input.dispose();
    _scroll.dispose();
    _draftTitle.dispose();
    super.dispose();
  }

  void _onInputChanged() => _chat.setInput(_input.text);

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

    // provider が文を書き換えたとき（送信成功で空にする・新しい下書き）だけ欄へ反映する。
    // 画面での入力は _onInputChanged で provider へ書き戻しているので、ここでは一致する
    if (_input.text != next.input) _input.text = next.input;
    if (_draftTitle.text != next.draftTitle) _draftTitle.text = next.draftTitle;
  }

  void _openTask(String id) => context.push('/tasks/$id');

  // ---- 表示 ----

  @override
  Widget build(BuildContext context) {
    // ラピ本人は AppBar のタイトル位置（アバター＋その真下の名前）の1か所だけに出し、
    // 発言ごとにはアバターを付けない。挨拶も普通のラピの発言として並べる
    final chat = ref.watch(rapiChatProvider);
    ref.listen(rapiChatProvider, _onChatChanged);
    final items = <Widget>[
      if (chat.surveyVisible) _buildSurveyCard(context, chat),
      for (final m in chat.messages) _buildMessage(context, chat, m),
      if (chat.sending) const _ThinkingRow(),
    ];

    return Scaffold(
      drawer: const AppDrawer(),
      // 会話エリアを広く取るため、ラピはヒーローではなくタイトル欄に置く。
      // この画面ではバーの帯に見せないよう、AppBar を透明にしてページの地色と一体にし、
      // ラピとガラス風ボタンだけが浮いて見えるようにする（スクロール時の色付き・影も消す）
      appBar: AppBar(
        centerTitle: true,
        toolbarHeight: _rapiToolbarHeight,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: const _GlassMenuButton(),
        title: const _RapiTitle(),
      ),
      body: Column(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () => FocusScope.of(context).unfocus(),
              // 上へ流れた発言がタイトル欄の真下でぶつ切りに見えないよう、上端を短くフェードさせる
              child: ShaderMask(
                blendMode: BlendMode.dstIn,
                shaderCallback: (rect) => LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: const [Colors.transparent, Colors.black],
                  stops: [0, rect.height == 0 ? 0 : (_topFade / rect.height).clamp(0.0, 1.0)],
                ).createShader(rect),
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(16, _topFade, 16, 12),
                  children: items,
                ),
              ),
            ),
          ),
          _Composer(
            controller: _input,
            placeholder: _placeholder,
            canSend: !chat.sending && chat.input.trim().isNotEmpty,
            onSend: _chat.send,
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

    switch (m.role) {
      case RapiRole.user:
        return _spaced(_UserMessage(text: m.text));
      case RapiRole.assistant:
        return _spaced(_RapiMessage(text: m.text));
      case RapiRole.system:
        final taskId = m.taskId;
        return _spaced(_SystemNote(
          text: m.text,
          onOpen: taskId == null ? null : () => _openTask(taskId),
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
    final canCreate =
        selected != null && chat.draftTitle.trim().isNotEmpty && !chat.creating;

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
                style: const TextStyle(fontSize: 14, color: bodyColor),
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
          if (draft.acceptanceCriteria.isNotEmpty) ...[
            const SizedBox(height: 8),
            const Text('完了条件', style: labelStyle),
            for (final c in draft.acceptanceCriteria)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text('・$c', style: const TextStyle(fontSize: 13, color: bodyColor)),
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

  const _SystemNote({required this.text, this.onOpen});

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

/// 下部のチャット欄（角丸の入力欄＋丸い送信ボタン）
class _Composer extends StatelessWidget {
  final TextEditingController controller;
  final String placeholder;
  final bool canSend;
  final VoidCallback onSend;

  const _Composer({
    required this.controller,
    required this.placeholder,
    required this.canSend,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Container(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: scheme.outlineVariant),
          ),
          padding: const EdgeInsets.fromLTRB(16, 4, 6, 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  minLines: 1,
                  maxLines: 5,
                  textInputAction: TextInputAction.newline,
                  inputFormatters: [LengthLimitingTextInputFormatter(_maxTextLength)],
                  style: const TextStyle(fontSize: 15),
                  decoration: InputDecoration(
                    hintText: placeholder,
                    hintMaxLines: 1,
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
                child: Material(
                  color: canSend ? _indigo : scheme.outlineVariant,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: canSend ? onSend : null,
                    child: const SizedBox(
                      width: 40,
                      height: 40,
                      child: Icon(Icons.arrow_upward, color: Colors.white, size: 22),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
