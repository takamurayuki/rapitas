import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/rapi.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';

// ラピのチャット画面（デスクトップ rapi-avatar パネルのモバイル移植 v1）。
//
// ラピは汎用チャットボットではなく「ユーザーがやること／ラピがやること」の境界を
// 守るエージェント。モードは専用 API に対応していて、会話モードで送った文は
// まず /assistant/route で振り分ける。v1 で実装するのは 会話・作る・聞く・見守り。
// それ以外の振り分け先（consult/tidy/roadmap/change）は「デスクトップ版で対応」と
// 正直に伝え、会話でごまかさない。
//
// NOTE: 会話は画面を閉じると消える（永続化しない）。
// NOTE: routes.dart は import しない（循環を避けるためパスは文字列で書く）。

enum RapiMode { chat, create, ask, watch }

extension on RapiMode {
  String get label => switch (this) {
        RapiMode.chat => '会話',
        RapiMode.create => '作る',
        RapiMode.ask => '聞く',
        RapiMode.watch => '見守り',
      };

  String get placeholder => switch (this) {
        RapiMode.chat || RapiMode.watch => 'やりたいことをそのまま書いてください',
        RapiMode.create => 'やりたいことを書いてください（例: 緊急 アバターを直す 2時間）',
        RapiMode.ask => '例: ブロックされているタスクは？',
      };
}

/// v1 では実装していない振り分け先（デスクトップのモード名）
const Map<String, String> _desktopOnlyIntents = {
  'consult': 'このタスク',
  'tidy': '片付ける',
  'roadmap': '計画を立てる',
  'change': '変更する',
};

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

/// copilot/chat に送る履歴の件数
const int _historyLimit = 10;

const _indigo = Color(0xFF4F46E5);
const _bubbleGray = Color(0xFFF4F4F5);
const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _rapiGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF8B5CF6), Color(0xFF6366F1)],
);

enum _Role { user, assistant, system }

/// 会話の1件。[draftSlot] は下書きカードの置き場所、[answer] は聞くモードの回答。
class _Message {
  final int id;
  final _Role role;
  final String text;
  final AskAnswer? answer;
  final bool draftSlot;

  /// 起票したタスク（system メッセージから開ける）
  final String? taskId;

  /// copilot/chat の履歴に含めるか（挨拶・送信失敗した発言は含めない）
  final bool inHistory;

  const _Message({
    required this.id,
    required this.role,
    this.text = '',
    this.answer,
    this.draftSlot = false,
    this.taskId,
    this.inHistory = false,
  });

  _Message withoutHistory() => _Message(
        id: id,
        role: role,
        text: text,
        answer: answer,
        draftSlot: draftSlot,
        taskId: taskId,
      );
}

class RapiScreen extends ConsumerStatefulWidget {
  const RapiScreen({super.key});

  @override
  ConsumerState<RapiScreen> createState() => _RapiScreenState();
}

class _RapiScreenState extends ConsumerState<RapiScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _draftTitle = TextEditingController();

  RapiMode _mode = RapiMode.chat;
  final List<_Message> _messages = [];
  int _nextId = 0;
  bool _sending = false;

  // 作るモード：いま確認待ちの下書き
  TaskDraft? _draft;
  String? _draftThemeId;
  bool _creating = false;

  // 見守りモード
  SupervisionSurvey? _survey;
  bool _surveyLoading = false;
  bool _surveyFailed = false;
  Future<void>? _surveyInFlight;

  @override
  void initState() {
    super.initState();
    _messages.add(_Message(
      id: _nextId++,
      role: _Role.assistant,
      text: 'ぼくは rapitas 専属のエージェント、ラピです。今日は何をしますか？'
          'やりたいことを下の欄にそのまま書いてください。',
    ));
    _input.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    _input.removeListener(_onInputChanged);
    _input.dispose();
    _scroll.dispose();
    _draftTitle.dispose();
    super.dispose();
  }

  void _onInputChanged() => setState(() {});

  // ---- 会話の操作 ----

  void _add(_Message Function(int id) build) {
    setState(() => _messages.add(build(_nextId++)));
    _scrollToEnd();
  }

  void _system(String text, {String? taskId}) =>
      _add((id) => _Message(id: id, role: _Role.system, text: text, taskId: taskId));

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

  /// 直近 [_historyLimit] 件の user / assistant の発言（今回の発言は含めない）
  List<Map<String, String>> _history() {
    final turns = _messages
        .where((m) => m.inHistory && m.role != _Role.system && m.text.isNotEmpty)
        .map((m) => {
              'role': m.role == _Role.user ? 'user' : 'assistant',
              'content': m.text,
            })
        .toList();
    return turns.length > _historyLimit
        ? turns.sublist(turns.length - _historyLimit)
        : turns;
  }

  void _setMode(RapiMode mode) {
    if (_mode == mode) return;
    setState(() => _mode = mode);
    if (mode == RapiMode.watch) _loadSurvey();
  }

  // ---- 送信 ----

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;

    final history = _history();
    final userId = _nextId;
    _add((id) => _Message(id: id, role: _Role.user, text: text, inHistory: true));
    setState(() => _sending = true);

    try {
      switch (_mode) {
        case RapiMode.chat:
        case RapiMode.watch:
          // 見守りモードでも送信は会話と同じ振り分けにする（モード切替の手間を増やさない）
          await _routeAndHandle(text, history);
        case RapiMode.create:
          await _runDraft(text);
        case RapiMode.ask:
          await _runAsk(text);
      }
      if (!mounted) return;
      // 成功したときだけ欄を空にする（失敗時は書いた文を残す）。
      // 送信中に書き足していたらそれは消さない
      if (_input.text.trim() == text) _input.clear();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        final i = _messages.indexWhere((m) => m.id == userId);
        if (i >= 0) _messages[i] = _messages[i].withoutHistory();
      });
      _system('送信に失敗しました');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _routeAndHandle(String text, List<Map<String, String>> history) async {
    final service = ref.read(assistantServiceProvider);
    final routed = await service.routeIntent(text);
    if (!mounted) return;

    String took(String where) {
      final reason = routed.reason;
      return reason != null && reason.isNotEmpty
          ? '$whereとして受け取りました — $reason'
          : '$whereとして受け取りました';
    }

    switch (routed.intent) {
      case 'create':
        _setMode(RapiMode.create);
        _system(took('タスク作成'));
        await _runDraft(text);
      case 'ask':
        _setMode(RapiMode.ask);
        _system(took('タスクへの問い合わせ'));
        await _runAsk(text);
      case 'watch':
        _system(took('見守り'));
        // 送信経由は読み込み完了を待ち、失敗は _send() の失敗処理へ伝える
        // （_setMode が始めた読み込みがあればそれに合流する）
        _setMode(RapiMode.watch);
        await _loadSurvey(propagateError: true);
      case final String intent when _desktopOnlyIntents.containsKey(intent):
        _system('「${_desktopOnlyIntents[intent]}」の操作はデスクトップ版で対応しています。'
            'デスクトップの rapitas でラピに頼んでください。');
      default:
        // chat と未振り分けは会話として返す
        final reply = await service.chat(text, history: history);
        if (!mounted) return;
        _add((id) => _Message(
              id: id,
              role: _Role.assistant,
              text: reply.content,
              inHistory: true,
            ));
    }
  }

  // ---- 作るモード ----

  Future<void> _runDraft(String text) async {
    final draft = await ref.read(assistantServiceProvider).createDraft(text);
    if (!mounted) return;
    setState(() {
      // 下書きは常に1枚。前の下書きは置き換える
      _messages.removeWhere((m) => m.draftSlot);
      _draft = draft;
      _draftThemeId = draft.themeId;
      _draftTitle.text = draft.title;
    });
    _add((id) => _Message(id: id, role: _Role.assistant, draftSlot: true));
  }

  void _discardDraft() {
    setState(() {
      _messages.removeWhere((m) => m.draftSlot);
      _draft = null;
      _draftThemeId = null;
    });
  }

  Future<void> _createFromDraft() async {
    final draft = _draft;
    final themeId = _draftThemeId;
    final title = _draftTitle.text.trim();
    if (draft == null || themeId == null || title.isEmpty || _creating) return;

    setState(() => _creating = true);
    try {
      final id = await ref.read(assistantServiceProvider).createTask(
            title: title,
            themeId: themeId,
            description: draft.description,
            priority: draft.priority,
            dueDate: draft.dueDate,
            estimatedHours: draft.estimatedHours,
            acceptanceCriteria: draft.acceptanceCriteria,
          );
      if (!mounted) return;
      ref.invalidate(taskListProvider);
      // 作成中に別の下書きへ置き換わっていたら、そちらは消さない
      if (identical(_draft, draft)) _discardDraft();
      _system('「$title」を起票しました', taskId: id);
    } catch (_) {
      if (!mounted) return;
      _system('起票に失敗しました。もう一度試してください。');
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  // ---- 聞くモード ----

  Future<void> _runAsk(String text) async {
    final answer = await ref.read(assistantServiceProvider).ask(text);
    if (!mounted) return;
    _add((id) => _Message(id: id, role: _Role.assistant, answer: answer));
  }

  // ---- 見守りモード ----

  /// 見守りの読み込み。読み込み中に呼ばれたら進行中のものに合流する。
  /// [propagateError] が false（チップ・再読み込みボタン）なら失敗はカード内表示だけ、
  /// true（送信経由）なら失敗を呼び出し元へ投げ直す。
  Future<void> _loadSurvey({bool propagateError = false}) async {
    final inFlight = _surveyInFlight ??=
        _fetchSurvey().whenComplete(() => _surveyInFlight = null);
    if (propagateError) {
      await inFlight;
      return;
    }
    try {
      await inFlight;
    } catch (_) {
      // カード内の「見に行けませんでした。」で伝える
    }
  }

  Future<void> _fetchSurvey() async {
    setState(() {
      _surveyLoading = true;
      _surveyFailed = false;
    });
    try {
      final survey = await ref.read(assistantServiceProvider).getSupervision();
      if (!mounted) return;
      setState(() => _survey = survey);
    } catch (_) {
      if (mounted) setState(() => _surveyFailed = true);
      rethrow;
    } finally {
      if (mounted) setState(() => _surveyLoading = false);
    }
  }

  void _openTask(String id) => context.push('/tasks/$id');

  // ---- 表示 ----

  @override
  Widget build(BuildContext context) {
    final items = <Widget>[
      if (_mode == RapiMode.watch) _buildSurveyCard(context),
      for (final m in _messages) _buildMessage(context, m),
      if (_sending) const _LoadingBubble(),
    ];

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: const Row(
          children: [
            _RapiAvatar(size: 32),
            SizedBox(width: 10),
            Text('ラピ', style: TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
      body: Column(
        children: [
          _ModeChips(mode: _mode, onSelected: _setMode),
          const Divider(height: 1),
          Expanded(
            child: GestureDetector(
              onTap: () => FocusScope.of(context).unfocus(),
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                children: items,
              ),
            ),
          ),
          _Composer(
            controller: _input,
            placeholder: _mode.placeholder,
            canSend: !_sending && _input.text.trim().isNotEmpty,
            onSend: _send,
          ),
        ],
      ),
    );
  }

  Widget _buildMessage(BuildContext context, _Message m) {
    if (m.draftSlot) {
      final draft = _draft;
      if (draft == null) return const SizedBox.shrink();
      return _bubbleSpacing(_buildDraftCard(context, draft));
    }
    final answer = m.answer;
    if (answer != null) return _bubbleSpacing(_AskAnswerCard(answer: answer, onOpen: _openTask));

    switch (m.role) {
      case _Role.user:
        return _bubbleSpacing(_Bubble(text: m.text, mine: true));
      case _Role.assistant:
        return _bubbleSpacing(_Bubble(text: m.text, mine: false));
      case _Role.system:
        final taskId = m.taskId;
        return _bubbleSpacing(_SystemNote(
          text: m.text,
          onOpen: taskId == null ? null : () => _openTask(taskId),
        ));
    }
  }

  Widget _bubbleSpacing(Widget child) =>
      Padding(padding: const EdgeInsets.only(bottom: 10), child: child);

  Widget _buildDraftCard(BuildContext context, TaskDraft draft) {
    // テーマの選択肢：下書きの候補 → 無ければテーマ一覧
    var options = draft.themeCandidates;
    if (options.isEmpty) {
      final themes = ref.watch(themeListProvider).valueOrNull ?? const [];
      options = [for (final t in themes) RapiThemeRef(id: t.id, name: t.name)];
    }
    final selected =
        options.any((t) => t.id == _draftThemeId) ? _draftThemeId : null;
    final canCreate =
        selected != null && _draftTitle.text.trim().isNotEmpty && !_creating;

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
            onChanged: (_) => setState(() {}),
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
                onChanged: _creating ? null : (v) => setState(() => _draftThemeId = v),
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
                  onPressed: canCreate ? _createFromDraft : null,
                  child: Text(_creating ? '起票しています…' : 'この内容で作成'),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
                onPressed: _creating ? null : _discardDraft,
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

  Widget _buildSurveyCard(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final survey = _survey;
    final muted = TextStyle(fontSize: 12, color: scheme.onSurfaceVariant);

    final children = <Widget>[
      Row(
        children: [
          const Expanded(
            child: Text('手当てが要るもの',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          ),
          TextButton.icon(
            onPressed: _surveyLoading ? null : _loadSurvey,
            icon: _surveyLoading
                ? const SizedBox(
                    width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh, size: 18),
            label: Text(_surveyLoading ? '見ています…' : 'もう一度見る'),
          ),
        ],
      ),
    ];

    if (_surveyFailed) {
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

class _RapiAvatar extends StatelessWidget {
  final double size;

  const _RapiAvatar({required this.size});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(shape: BoxShape.circle, gradient: _rapiGradient),
      alignment: Alignment.center,
      child: Text(
        'ラ',
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.45,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ModeChips extends StatelessWidget {
  final RapiMode mode;
  final ValueChanged<RapiMode> onSelected;

  const _ModeChips({required this.mode, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        children: [
          for (final m in RapiMode.values)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(m.label),
                selected: m == mode,
                showCheckmark: false,
                selectedColor: _violetBg,
                side: BorderSide(
                  color: m == mode ? _violetBorder : Theme.of(context).colorScheme.outlineVariant,
                ),
                labelStyle: TextStyle(
                  fontSize: 13,
                  color: m == mode ? _violetButton : null,
                  fontWeight: m == mode ? FontWeight.w600 : FontWeight.normal,
                ),
                shape: const StadiumBorder(),
                onSelected: (_) => onSelected(m),
              ),
            ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final String text;
  final bool mine;

  const _Bubble({required this.text, required this.mine});

  @override
  Widget build(BuildContext context) {
    final maxWidth = MediaQuery.sizeOf(context).width * 0.85;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: mine ? _indigo : _bubbleGray,
            borderRadius: BorderRadius.circular(12),
          ),
          child: SelectableText(
            text,
            style: TextStyle(
              fontSize: 15,
              height: 1.45,
              color: mine ? Colors.white : const Color(0xFF18181B),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoadingBubble extends StatelessWidget {
  const _LoadingBubble();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: _bubbleGray,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF8B5CF6)),
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
    final maxWidth = MediaQuery.sizeOf(context).width * 0.85;

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

    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
          decoration: BoxDecoration(
            color: _bubbleGray,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      ),
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
                    border: InputBorder.none,
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
