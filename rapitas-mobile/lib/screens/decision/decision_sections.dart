import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/companion_provider.dart';
import '../../services/decision_service.dart';
import '../../utils/plain_reasons.dart';
import '../../widgets/markdown/task_description_markdown.dart';

// 判断画面の4つの節（計画承認／質問への回答／レビュー保留／停止の解除）。
// どの送信も DecisionService を通り、X-Rapitas-Source: ui を付けてバックエンドの人間専用ルートへ直接届く。

/// 判断を送り終えたときに呼ぶ（画面が読み直しと戻る処理をする）。[message] は結果の一文
typedef DecisionDone = void Function(String message);

/// 送信中・失敗の表示を共通にするための土台
abstract class _DecisionState<T extends ConsumerStatefulWidget> extends ConsumerState<T> {
  bool busy = false;
  String? error;

  DecisionService get service => ref.read(decisionServiceProvider);

  Future<void> submit(Future<void> Function() send, String doneMessage, DecisionDone onDone) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await send();
      if (mounted) onDone(doneMessage);
    } on DecisionFailure catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (_) {
      if (mounted) setState(() => error = '送れませんでした。通信を確かめて、もう一度押してください。');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget errorText(BuildContext context) => error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(error!,
              key: const ValueKey('decision-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 13)),
        );
}

Future<bool> _confirm(BuildContext context, String title, String body, String ok) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('やめる')),
        FilledButton(
            key: const ValueKey('decision-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: Text(ok)),
      ],
    ),
  );
  return result ?? false;
}

/// 計画・質問の本文（workflow ファイル）を枠の中に Markdown で出す
class _WorkflowDocument extends ConsumerStatefulWidget {
  final String taskId;
  final String fileType;
  final String emptyText;

  const _WorkflowDocument({required this.taskId, required this.fileType, required this.emptyText});

  @override
  ConsumerState<_WorkflowDocument> createState() => _WorkflowDocumentState();
}

class _WorkflowDocumentState extends ConsumerState<_WorkflowDocument> {
  // Read once: the section rebuilds on every keystroke in its text field.
  late final Future<String?> _content =
      ref.read(decisionServiceProvider).readWorkflowFile(widget.taskId, widget.fileType);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final emptyText = widget.emptyText;
    return FutureBuilder<String?>(
      future: _content,
      builder: (context, snap) {
        final Widget child;
        if (snap.connectionState != ConnectionState.done) {
          child = const Center(
              child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()));
        } else if (snap.hasError) {
          child = Text('読み込めませんでした。', style: TextStyle(color: scheme.error));
        } else if (snap.data == null) {
          child = Text(emptyText, style: TextStyle(color: scheme.onSurfaceVariant));
        } else {
          child = TaskDescriptionMarkdown(data: snap.data!);
        }
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: scheme.outlineVariant),
            borderRadius: BorderRadius.circular(10),
          ),
          child: child,
        );
      },
    );
  }
}

/// 計画承認と、計画の修正依頼（revise-plan）
class PlanDecisionSection extends ConsumerStatefulWidget {
  final String taskId;
  final DecisionDone onDone;
  const PlanDecisionSection({super.key, required this.taskId, required this.onDone});

  @override
  ConsumerState<PlanDecisionSection> createState() => _PlanDecisionState();
}

class _PlanDecisionState extends _DecisionState<PlanDecisionSection> {
  final _instruction = TextEditingController();
  bool _revising = false;

  @override
  void dispose() {
    _instruction.dispose();
    super.dispose();
  }

  Future<void> _approve() async {
    final ok = await _confirm(context, 'この計画で進めますか', '承認すると、エージェントが計画どおりに実装を始めます。', '承認する');
    if (!ok || !mounted) return;
    await submit(() => service.approvePlan(widget.taskId), '計画を承認しました。実装に進みます。', widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    final hasText = _instruction.text.trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('計画', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        _WorkflowDocument(taskId: widget.taskId, fileType: 'plan', emptyText: '計画の本文がまだありません。'),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('decision-approve-plan'),
          onPressed: busy ? null : _approve,
          child: const Text('この計画で進める'),
        ),
        const SizedBox(height: 8),
        if (!_revising)
          OutlinedButton(
            key: const ValueKey('decision-revise-open'),
            onPressed: busy ? null : () => setState(() => _revising = true),
            child: const Text('直してほしい点を伝える'),
          )
        else ...[
          TextField(
            key: const ValueKey('decision-revise-text'),
            controller: _instruction,
            minLines: 2,
            maxLines: 6,
            maxLength: 2000,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: '直してほしい点',
              hintText: '例：画面は1つにまとめてほしい',
              border: OutlineInputBorder(),
            ),
          ),
          OutlinedButton(
            key: const ValueKey('decision-revise-send'),
            onPressed: busy || !hasText
                ? null
                : () => submit(() => service.revisePlan(widget.taskId, _instruction.text),
                    '修正の依頼を送りました。計画を作り直します。', widget.onDone),
            child: const Text('修正を依頼する'),
          ),
        ],
        errorText(context),
      ],
    );
  }
}

/// エージェントの質問への回答
class QuestionDecisionSection extends ConsumerStatefulWidget {
  final String taskId;
  final DecisionDone onDone;
  const QuestionDecisionSection({super.key, required this.taskId, required this.onDone});

  @override
  ConsumerState<QuestionDecisionSection> createState() => _QuestionDecisionState();
}

class _QuestionDecisionState extends _DecisionState<QuestionDecisionSection> {
  final _answer = TextEditingController();

  @override
  void dispose() {
    _answer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('質問', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        _WorkflowDocument(
            taskId: widget.taskId, fileType: 'question', emptyText: '質問の本文が見つかりませんでした。'),
        const SizedBox(height: 16),
        TextField(
          key: const ValueKey('decision-answer-text'),
          controller: _answer,
          minLines: 2,
          maxLines: 8,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'あなたの回答', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('decision-answer-send'),
          onPressed: busy || _answer.text.trim().isEmpty
              ? null
              : () => submit(() => service.answerQuestion(widget.taskId, _answer.text),
                  '回答を送りました。エージェントが続きを進めます。', widget.onDone),
          child: const Text('回答を送る'),
        ),
        errorText(context),
      ],
    );
  }
}

/// レビュー保留の accept / override
class HoldDecisionSection extends ConsumerStatefulWidget {
  final String taskId;
  final DecisionDone onDone;
  const HoldDecisionSection({super.key, required this.taskId, required this.onDone});

  @override
  ConsumerState<HoldDecisionSection> createState() => _HoldDecisionState();
}

class _HoldDecisionState extends _DecisionState<HoldDecisionSection> {
  late final Future<ReviewHoldInfo?> _hold = service.readReviewHold(widget.taskId);

  Future<void> _override() async {
    final ok = await _confirm(
      context,
      'このまま進めますか',
      'レビューの指摘を上書きして、コミットと PR の作成へ進めます。指摘の内容は記録に残ります。',
      '上書きして進める',
    );
    if (!ok || !mounted) return;
    await submit(() => service.resolveReviewHold(widget.taskId, override: true),
        'レビューを上書きしました。公開の手順へ進みます。', widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('保留の理由', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        FutureBuilder<ReviewHoldInfo?>(
          future: _hold,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            final hold = snap.data;
            if (hold == null) {
              return Text(snap.hasError ? '保留の中身を読み込めませんでした。' : 'いまは保留になっていません。',
                  style: TextStyle(color: scheme.onSurfaceVariant));
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(holdReasonText(hold.reason), style: Theme.of(context).textTheme.bodyMedium),
                if (hold.detail.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(hold.detail,
                      style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant)),
                ],
                for (final f in hold.findings)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('・'),
                        Expanded(child: Text(f, style: const TextStyle(fontSize: 13))),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('decision-hold-accept'),
          onPressed: busy
              ? null
              : () => submit(() => service.resolveReviewHold(widget.taskId, override: false),
                  '指摘を受け入れました。エージェントが直します。', widget.onDone),
          child: const Text('指摘を受け入れて直してもらう'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const ValueKey('decision-hold-override'),
          onPressed: busy ? null : _override,
          child: const Text('このまま進める（上書き）'),
        ),
        errorText(context),
      ],
    );
  }
}

/// 止まったタスクの再開（release-halt）
class HaltDecisionSection extends ConsumerStatefulWidget {
  final String taskId;
  final String haltReason;
  final DecisionDone onDone;
  const HaltDecisionSection(
      {super.key, required this.taskId, required this.haltReason, required this.onDone});

  @override
  ConsumerState<HaltDecisionSection> createState() => _HaltDecisionState();
}

class _HaltDecisionState extends _DecisionState<HaltDecisionSection> {
  final _hypothesis = TextEditingController();

  @override
  void dispose() {
    _hypothesis.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enough = _hypothesis.text.trim().length >= DecisionService.minHypothesisChars;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('止まった理由', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        Text(haltReasonText(widget.haltReason), style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 16),
        TextField(
          key: const ValueKey('decision-halt-text'),
          controller: _hypothesis,
          minLines: 2,
          maxLines: 6,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: '次はなぜうまくいくか',
            hintText: '例：テスト用の設定を直したので、同じ失敗はしないはず',
            helperText: '${DecisionService.minHypothesisChars}文字以上で書いてください。同じやり方のままの再開を防ぐためです。',
            helperMaxLines: 2,
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('decision-halt-send'),
          onPressed: busy || !enough
              ? null
              : () => submit(() => service.releaseHalt(widget.taskId, _hypothesis.text),
                  '停止を解除しました。', widget.onDone),
          child: const Text('再開する'),
        ),
        errorText(context),
      ],
    );
  }
}
