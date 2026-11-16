import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/rapi.dart';
import '../../providers/rapi_chat_provider.dart';
import '../../providers/theme_data_provider.dart';

part 'rapi_tidy_rows.dart';

// 片付け（tidy）カード（デスクトップ TaskTidy.tsx / TaskBulkCleanup.tsx / TaskCleanup.tsx のモバイル版）。
//
// 段階ごとに出すもの：
//   選ぶ（setup / searching）：出し方のチップ（条件で選ぶ／文章で選ぶ）。条件はテーマ・状態・最終更新
//     （デスクトップと同じ項目と初期値）、文章は振り分けられた発言。「該当するタスクを見る」／
//     「候補を探してもらう」「やめる」。該当なし・候補を出せなかったときはその理由
//   確認（listing / deleting）：件数（条件は総数・載りきらなかった分・保護で外した分、文章は検討した件数）、
//     チェック付きの候補（初期は全部チェック。タップで外せる）、「削除する（N件）」「選び直す」
//   結果（done）：削除した分（1件ずつ「戻す」・まとめて「元に戻す」）と、削除しなかった分を理由ごとに
// 見た目は変更カード・計画カードにそろえ、削除のボタンだけ赤にする（デスクトップと同じ）。

const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
const _mutedStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.45);
const _hintStyle = TextStyle(fontSize: 11, color: Color(0xFF9CA3AF), height: 1.4);
const _bodyColor = Color(0xFF18181B);
const _doneGreen = Color(0xFF047857);
const _warnAmber = Color(0xFFB45309);
const _deleteRed = Color(0xFFDC2626);

/// 候補・結果の状態の表示名（条件の状態にない in-progress も出しうる）
const Map<String, String> _statusLabels = {
  ...rapiTidyStatusLabels,
  'in-progress': '進行中',
  'in_progress': '進行中',
};

/// テーマ選択の「すべてのテーマ」（DropdownButton の値は null にできないので印を使う）
const String _anyTheme = '';

class RapiTidyCardView extends ConsumerWidget {
  final RapiTidyCard card;
  final ValueChanged<RapiTidyHow> onHow;
  final ValueChanged<String?> onTheme;
  final ValueChanged<String> onStatus;
  final ValueChanged<int> onDays;
  final VoidCallback onSearch;
  final ValueChanged<String> onToggle;
  final ValueChanged<bool> onAll;
  final VoidCallback onExpand;
  final VoidCallback onBack;
  final VoidCallback onCancel;
  final VoidCallback onDelete;
  final ValueChanged<int> onRestore;
  final VoidCallback onRestoreAll;
  final VoidCallback onOpenTasks;

  /// 会話スペースから読み込んだ記録：条件・候補のチェック・削除・元に戻すをすべて止める。
  /// 「すべて見る」（表示の展開）とタスク一覧を開く操作は生かす（設計 nav39 5.3.1）
  final bool readOnly;

  const RapiTidyCardView({
    super.key,
    required this.card,
    required this.onHow,
    required this.onTheme,
    required this.onStatus,
    required this.onDays,
    required this.onSearch,
    required this.onToggle,
    required this.onAll,
    required this.onExpand,
    required this.onBack,
    required this.onCancel,
    required this.onDelete,
    required this.onRestore,
    required this.onRestoreAll,
    required this.onOpenTasks,
    this.readOnly = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final phase = card.phase;
    final run = card.run;
    final choosing = phase == RapiTidyPhase.setup || phase == RapiTidyPhase.searching;
    final confirming = phase == RapiTidyPhase.listing || phase == RapiTidyPhase.deleting;

    final deleted = run?.deleted ?? const <TaskDeletion>[];
    final allRestored = deleted.isNotEmpty &&
        deleted.every((d) =>
            d.trashId != null && card.restoreOf(d.trashId!) == RapiTidyRestore.restored);
    final troubled = run != null && (!run.complete || run.refused.isNotEmpty);
    final String heading = switch (phase) {
      RapiTidyPhase.setup || RapiTidyPhase.searching => '片付けるタスクを選ぶ',
      RapiTidyPhase.listing || RapiTidyPhase.deleting => 'このタスクを削除しますか',
      RapiTidyPhase.done when allRestored => '元に戻しました',
      RapiTidyPhase.done when deleted.isEmpty => '削除できませんでした',
      RapiTidyPhase.done when troubled => '一部を削除できませんでした',
      RapiTidyPhase.done => '${deleted.length}件を削除しました',
    };
    final warn = phase == RapiTidyPhase.done && troubled && !allRestored;
    final headingColor = warn ? _warnAmber : _violetButton;
    final IconData icon = switch (phase) {
      RapiTidyPhase.done when allRestored => Icons.undo,
      RapiTidyPhase.done when warn => Icons.warning_amber_rounded,
      RapiTidyPhase.done => Icons.check_circle,
      _ => Icons.delete_sweep_outlined,
    };

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
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Icon(icon, size: 16, color: headingColor),
              ),
              Expanded(
                child: Text(heading,
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: headingColor, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          if (choosing) ..._setup(context, ref),
          if (confirming) ..._listing(),
          if (phase == RapiTidyPhase.done && run != null) ..._result(run),
          if (card.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(card.error!,
                  style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
            ),
        ],
      ),
    );
  }

  // ---- 選ぶ ----

  List<Widget> _setup(BuildContext context, WidgetRef ref) {
    final searching = card.phase == RapiTidyPhase.searching;
    final locked = searching || readOnly;
    final byCondition = card.how == RapiTidyHow.condition;
    return [
      const SizedBox(height: 10),
      Wrap(
        spacing: 6,
        children: [
          _chip('rapi-tidy-how-condition', '条件で選ぶ', byCondition,
              locked ? null : () => onHow(RapiTidyHow.condition)),
          _chip('rapi-tidy-how-text', '文章で選ぶ', !byCondition,
              locked ? null : () => onHow(RapiTidyHow.text)),
        ],
      ),
      const SizedBox(height: 4),
      Text(
          byCondition
              ? '状態と期間で絞って、一覧から選んで消します。'
              : 'さっきの文をもとに、最近更新されたタスクから消してよさそうなものを挙げます。',
          style: _hintStyle),
      const SizedBox(height: 10),
      if (byCondition) ..._conditionForm(context, ref, locked) else ..._textForm(),
      if (card.notice != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(card.notice!,
              style: const TextStyle(fontSize: 12, color: _warnAmber, height: 1.4)),
        ),
      const SizedBox(height: 12),
      if (!readOnly)
      Row(
        children: [
          Expanded(
            child: FilledButton(
              key: const ValueKey('rapi-tidy-search'),
              style: _violetFilled,
              onPressed: card.canSearch ? onSearch : null,
              child: Text(switch ((byCondition, searching)) {
                (true, true) => '数えています…',
                (true, false) => '該当するタスクを見る',
                (false, true) => '探しています…',
                (false, false) => '候補を探してもらう',
              }),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('rapi-tidy-cancel'),
            style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
            onPressed: searching ? null : onCancel,
            child: const Text('やめる'),
          ),
        ],
      ),
    ];
  }

  List<Widget> _conditionForm(BuildContext context, WidgetRef ref, bool searching) {
    // DropdownButton の style は周りの文字の設定を引き継がないので、テーマの本文から作る
    final fieldStyle = (Theme.of(context).textTheme.bodyMedium ?? const TextStyle())
        .copyWith(fontSize: 14, color: _bodyColor);
    final themes = ref.watch(themeListProvider).valueOrNull ?? const [];
    final filter = card.filter;
    final themeValue =
        themes.any((t) => t.id == filter.themeId) ? filter.themeId! : _anyTheme;
    return [
      const Text('テーマ', style: _labelStyle),
      const SizedBox(height: 4),
      // NOTE: DropdownButtonFormField.value は非推奨なので、既存画面と同じく
      // InputDecorator + DropdownButton で組む（選択値は状態から毎回渡す）
      _dropdownFrame(DropdownButton<String>(
        key: const ValueKey('rapi-tidy-theme'),
        value: themeValue,
        isExpanded: true,
        dropdownColor: Colors.white,
        style: fieldStyle,
        items: [
          const DropdownMenuItem(value: _anyTheme, child: Text('すべてのテーマ')),
          for (final t in themes)
            DropdownMenuItem(
                value: t.id, child: Text(t.name, overflow: TextOverflow.ellipsis)),
        ],
        onChanged: searching ? null : (v) => onTheme(v == null || v == _anyTheme ? null : v),
      )),
      const SizedBox(height: 10),
      const Text('状態', style: _labelStyle),
      const SizedBox(height: 4),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final s in rapiTidyStatuses)
            _chip('rapi-tidy-status-$s', rapiTidyStatusLabels[s] ?? s,
                filter.statuses.contains(s), searching ? null : () => onStatus(s)),
        ],
      ),
      if (filter.statuses.isEmpty)
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('状態を1つ以上選んでください', style: _hintStyle),
        ),
      const SizedBox(height: 10),
      const Text('最終更新', style: _labelStyle),
      const SizedBox(height: 4),
      _dropdownFrame(DropdownButton<int>(
        key: const ValueKey('rapi-tidy-days'),
        value: rapiTidyAges.contains(filter.days) ? filter.days : rapiTidyAges.first,
        isExpanded: true,
        dropdownColor: Colors.white,
        style: fieldStyle,
        items: [
          for (final d in rapiTidyAges)
            DropdownMenuItem(value: d, child: Text(d == 0 ? '期間を問わない' : '$d日以上前')),
        ],
        onChanged: searching ? null : (v) => v == null ? null : onDays(v),
      )),
    ];
  }

  List<Widget> _textForm() => [
        const Text('依頼の文', style: _labelStyle),
        const SizedBox(height: 4),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: _violetBorder),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(card.text,
              style: const TextStyle(fontSize: 13.5, color: _bodyColor, height: 1.45)),
        ),
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('文を変えたいときは、チャットに送り直してください。', style: _hintStyle),
        ),
      ];

  // ---- 確認 ----

  List<Widget> _listing() {
    final deleting = card.phase == RapiTidyPhase.deleting;
    final locked = deleting || readOnly;
    final items = card.items;
    final shown = card.visibleItems;
    final count = card.chosenIds.length;
    final allChosen = items.every((i) => card.chosen.contains(i.id));
    final progress = card.progress;
    final byCondition = card.listedBy == RapiTidyHow.condition;

    return [
      const SizedBox(height: 10),
      Row(
        children: [
          Expanded(
            child: Text(
              byCondition ? '${card.total}件が該当しました' : '${items.length}件の候補があります',
              style: const TextStyle(
                  fontSize: 14, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4),
            ),
          ),
          TextButton(
            key: const ValueKey('rapi-tidy-all'),
            style: TextButton.styleFrom(
              foregroundColor: _violetButton,
              visualDensity: VisualDensity.compact,
            ),
            onPressed: locked ? null : () => onAll(!allChosen),
            child: Text(allChosen ? 'すべて外す' : 'すべて選ぶ',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
      if (byCondition && card.truncated)
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(
              'うち${items.length}件を表示しています。残りは削除したあと、もう一度条件で探してください。',
              style: const TextStyle(fontSize: 11.5, color: _warnAmber, height: 1.4)),
        ),
      if (byCondition && card.excludedProtected > 0)
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text('保護された${card.excludedProtected}件は対象外です', style: _hintStyle),
        ),
      if (!byCondition && card.considered > 0)
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text('最近更新された${card.considered}件の中から選びました（すべてのタスクではありません）',
              style: _hintStyle),
        ),
      const SizedBox(height: 4),
      for (final item in shown) _CandidateRow(
        key: ValueKey('rapi-tidy-item-${item.id}'),
        item: item,
        checked: card.chosen.contains(item.id),
        onTap: locked ? null : () => onToggle(item.id),
      ),
      if (card.hiddenCount > 0) ...[
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: const ValueKey('rapi-tidy-expand'),
            style: TextButton.styleFrom(foregroundColor: _violetButton),
            onPressed: deleting && !readOnly ? null : onExpand,
            child: Text('残り${card.hiddenCount}件も表示'),
          ),
        ),
        Text('削除するのは表示している${shown.length}件のうち、チェックが付いたものだけです。'
            '残りも消すときは、表示して確かめてください。',
            style: const TextStyle(fontSize: 11.5, color: _warnAmber, height: 1.4)),
      ],
      if (!byCondition && card.unclear.isNotEmpty) ...[
        const SizedBox(height: 8),
        const Text('ラピが判断できなかったこと', style: _labelStyle),
        for (final u in card.unclear)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text('・$u', style: _mutedStyle),
          ),
      ],
      const SizedBox(height: 8),
      const Text('削除したタスクはゴミ箱に入り、このカードから元に戻せます。', style: _hintStyle),
      const SizedBox(height: 10),
      if (!readOnly)
      Row(
        children: [
          Expanded(
            child: FilledButton.icon(
              key: const ValueKey('rapi-tidy-delete'),
              style: FilledButton.styleFrom(
                backgroundColor: _deleteRed,
                foregroundColor: Colors.white,
                disabledBackgroundColor: _deleteRed.withValues(alpha: 0.4),
                disabledForegroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: card.canDelete ? onDelete : null,
              icon: const Icon(Icons.delete_outline, size: 18),
              label: Text(deleting
                  ? (progress != null && progress.$2 > 1
                      ? '削除しています… ${progress.$1}/${progress.$2}'
                      : '削除しています…')
                  : '削除する（$count件）'),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('rapi-tidy-back'),
            style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
            onPressed: deleting ? null : onBack,
            child: const Text('選び直す'),
          ),
        ],
      ),
    ];
  }

  // ---- 結果 ----

  List<Widget> _result(TaskDeleteRun run) {
    final deleted = run.deleted;
    final shown =
        card.expanded ? deleted : deleted.take(RapiTidyCard.previewRows).toList();
    final restorable = card.restorable;
    final busy = card.restoring;

    List<String> refusedAs(String outcome) =>
        [for (final r in run.refused) if (r.outcome == outcome) r.taskId];

    final groups = <(String, String, List<String>)>[
      ('protected', '保護されているため削除しませんでした', refusedAs('protected')),
      ('not_found', '見つかりませんでした（すでに削除されていた可能性があります）', refusedAs('not_found')),
      ('failed', '削除に失敗しました', refusedAs('failed')),
      ('unknown', '応答がなく、削除できたか確かめられませんでした。タスク一覧で確かめてください', run.unknown),
      ('rejected', '受け付けられなかったため削除していません', run.rejected),
      ('unsent', '途中で止まったため送っていません（削除していません）', run.unsent),
    ];

    return [
      const SizedBox(height: 10),
      if (deleted.isNotEmpty) ...[
        Text('削除した${deleted.length}件',
            style: const TextStyle(
                fontSize: 13, color: _doneGreen, fontWeight: FontWeight.w600, height: 1.4)),
        for (final d in shown)
          _DeletedRow(
            key: ValueKey('rapi-tidy-deleted-${d.taskId}'),
            title: card.titleOf(d.taskId),
            trashId: d.trashId,
            restore: d.trashId == null ? null : card.restoreOf(d.trashId!),
            onRestore:
                busy || readOnly || d.trashId == null ? null : () => onRestore(d.trashId!),
            readOnly: readOnly,
          ),
        if (shown.length < deleted.length)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const ValueKey('rapi-tidy-expand'),
              style: TextButton.styleFrom(foregroundColor: _violetButton),
              onPressed: onExpand,
              child: Text('残り${deleted.length - shown.length}件も表示'),
            ),
          ),
      ],
      for (final (key, label, ids) in groups)
        if (ids.isNotEmpty)
          Padding(
            key: ValueKey('rapi-tidy-group-$key'),
            padding: const EdgeInsets.only(top: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$label（${ids.length}件）',
                    style: const TextStyle(
                        fontSize: 12, color: _warnAmber, fontWeight: FontWeight.w600, height: 1.4)),
                for (final id in ids.take(5))
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text('・${card.titleOf(id)}',
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: _mutedStyle),
                  ),
                if (ids.length > 5) Text('ほか${ids.length - 5}件', style: _mutedStyle),
              ],
            ),
          ),
      const SizedBox(height: 12),
      // 1行に並べると狭い端末で溢れるので、まとめての取り消しは全幅で1行に置く
      if (!readOnly && (restorable.length > 1 || (busy && deleted.length > 1)))
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const ValueKey('rapi-tidy-restore-all'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _violetButton,
              side: const BorderSide(color: _violetBorder),
              backgroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: busy ? null : onRestoreAll,
            icon: const Icon(Icons.undo, size: 18),
            label: Text(busy ? '元に戻しています…' : '${restorable.length}件をまとめて元に戻す'),
          ),
        ),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          key: const ValueKey('rapi-tidy-open-tasks'),
          style: TextButton.styleFrom(foregroundColor: _violetButton),
          onPressed: onOpenTasks,
          child: const Text('タスク一覧を見る'),
        ),
      ),
    ];
  }

  // ---- 部品 ----

  static final ButtonStyle _violetFilled = FilledButton.styleFrom(
    backgroundColor: _violetButton,
    foregroundColor: Colors.white,
    disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
    disabledForegroundColor: Colors.white,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
  );

  static Widget _chip(String key, String label, bool selected, VoidCallback? onTap) => ChoiceChip(
        key: ValueKey(key),
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        labelStyle: TextStyle(
          fontSize: 12.5,
          color: selected ? Colors.white : _bodyColor,
          fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
        ),
        selectedColor: _violetButton,
        backgroundColor: Colors.white,
        side: BorderSide(color: selected ? _violetButton : _violetBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        visualDensity: VisualDensity.compact,
        onSelected: onTap == null ? null : (_) => onTap(),
      );

  static Widget _dropdownFrame(Widget dropdown) => InputDecorator(
        decoration: InputDecoration(
          isDense: true,
          filled: true,
          fillColor: Colors.white,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: _violetBorder),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: _violetBorder),
          ),
        ),
        child: DropdownButtonHideUnderline(child: dropdown),
      );
}
