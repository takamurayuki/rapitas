part of 'decision_sections.dart';

// 計画承認と、計画の修正依頼（revise-plan）。
//
// 計画が Prisma スキーマ（データベースの構造）の変更を含むと、バックエンドは普通の承認を断り、
// `overrideForbiddenChange: true` と理由を求める（workflow-handlers-plan.ts）。そのときは
// 断られたことをこの節の中で知らせ、理由の入力と確認を経て、理由付きで送り直す。
// 送り直しも DecisionService → HumanDecisionClient を通り、X-Rapitas-Source: ui が付く。

const _schemaBg = Color(0xFFFFFBEB);
const _schemaBorder = Color(0xFFFDE68A);
const _schemaText = Color(0xFF92400E);

/// バックエンドに保存される理由の長さの上限（画面側の目安。バックエンドは空かどうかだけを見る）
const _maxOverrideReason = 500;

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
  final _overrideReason = TextEditingController();
  bool _revising = false;

  /// バックエンドが「スキーマ変更を含むので理由が要る」と断った
  bool _needsSchemaOverride = false;

  @override
  void dispose() {
    _instruction.dispose();
    _overrideReason.dispose();
    super.dispose();
  }

  @override
  bool handleFailure(DecisionFailure failure) {
    if (failure is! SchemaChangeApprovalRequired) return false;
    // NOTE: 拒否文はエラーとして出さず、下の確認欄に置き換える（同じことを2回言わない）
    setState(() => _needsSchemaOverride = true);
    return true;
  }

  Future<void> _approve() async {
    final ok = await _confirm(context, 'この計画で進めますか', '承認すると、エージェントが計画どおりに実装を始めます。', '承認する');
    if (!ok || !mounted) return;
    await submit(() => service.approvePlan(widget.taskId), '計画を承認しました。実装に進みます。', widget.onDone);
  }

  Future<void> _approveWithSchemaChange() async {
    final reason = _overrideReason.text.trim();
    if (reason.isEmpty) return;
    final ok = await _confirm(
      context,
      'データベースの構造の変更を認めますか',
      '理由：$reason\n\n承認すると、エージェントが Prisma スキーマの変更も含めて実装を始めます。'
          '取り込んだあとは、サーバーの再起動が必要です。',
      '変更を認めて承認する',
    );
    if (!ok || !mounted) return;
    await submit(() => service.approvePlan(widget.taskId, overrideReason: reason),
        'データベースの構造の変更を認めて、計画を承認しました。実装に進みます。', widget.onDone);
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
        if (_needsSchemaOverride)
          _buildSchemaOverride(context)
        else
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

  /// スキーマ変更を含む計画の、明示の確認と理由の入力
  Widget _buildSchemaOverride(BuildContext context) {
    final hasReason = _overrideReason.text.trim().isNotEmpty;
    return Column(
      key: const ValueKey('decision-schema-override'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          decoration: BoxDecoration(
            color: _schemaBg,
            border: Border.all(color: _schemaBorder),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('データベースの構造が変わる計画です',
                  style: TextStyle(fontSize: 14, color: _schemaText, fontWeight: FontWeight.w600)),
              SizedBox(height: 4),
              Text(
                'この計画は Prisma スキーマ（データベースの構造）の変更を含むため、普通の承認では進めません。'
                '変えてよい理由を書いて承認してください。理由は承認の記録に残ります。',
                style: TextStyle(fontSize: 13, color: Color(0xFF3F3F46), height: 1.5),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('decision-schema-reason'),
          controller: _overrideReason,
          minLines: 2,
          maxLines: 5,
          maxLength: _maxOverrideReason,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: '変えてよい理由',
            hintText: '例：設定を保存する表が必要なため',
            border: OutlineInputBorder(),
          ),
        ),
        FilledButton(
          key: const ValueKey('decision-schema-approve'),
          onPressed: busy || !hasReason ? null : _approveWithSchemaChange,
          child: const Text('理由を添えて承認する'),
        ),
      ],
    );
  }
}
