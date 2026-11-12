// 片付けカードの行（候補1件・削除した1件。rapi_tidy_card.dart から切り出した部品。nav39 直し回1）。
//
// カードの定数（色・文字の型・状態の表示名）を共有するため part にしている。振る舞いは切り出す前と同じ。

part of 'rapi_tidy_card.dart';

/// 候補1件：チェック、題名、状態と最終更新日（条件）または理由（文章）。行のどこを押しても切り替わる
class _CandidateRow extends StatelessWidget {
  final TidyItem item;
  final bool checked;
  final VoidCallback? onTap;

  const _CandidateRow({super.key, required this.item, required this.checked, this.onTap});

  @override
  Widget build(BuildContext context) {
    final updated = item.updatedAt?.toLocal();
    final meta = [
      _statusLabels[item.status] ?? item.status,
      if (updated != null)
        '${updated.year}/${updated.month.toString().padLeft(2, '0')}/${updated.day.toString().padLeft(2, '0')} 更新',
    ].where((s) => s.isNotEmpty).join(' · ');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 36,
              height: 36,
              child: Checkbox(
                value: checked,
                activeColor: _deleteRed,
                side: const BorderSide(color: Color(0xFFA1A1AA), width: 1.5),
                visualDensity: VisualDensity.compact,
                onChanged: onTap == null ? null : (_) => onTap!(),
              ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13.5,
                          height: 1.35,
                          color: checked ? _bodyColor : const Color(0xFF9CA3AF),
                        )),
                    if (meta.isNotEmpty) Text(meta, style: _hintStyle),
                    if (item.reason.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(item.reason, style: _mutedStyle),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 削除した1件：題名と、戻すボタン（または戻した／戻せない の印）
class _DeletedRow extends StatelessWidget {
  final String title;
  final int? trashId;
  final RapiTidyRestore? restore;
  final VoidCallback? onRestore;

  /// 記録のカード：戻すボタン・処理中の印を出さない（結果の印だけを出す）
  final bool readOnly;

  const _DeletedRow({
    super.key,
    required this.title,
    required this.trashId,
    required this.restore,
    required this.onRestore,
    this.readOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    final Widget trailing = switch (restore) {
      RapiTidyRestore.idle || RapiTidyRestore.failed || RapiTidyRestore.restoring when readOnly =>
        const SizedBox.shrink(),
      null => const Text('控えが無いため戻せません', style: _hintStyle),
      RapiTidyRestore.restored => const Text('戻しました',
          style: TextStyle(fontSize: 12, color: _doneGreen, fontWeight: FontWeight.w600)),
      RapiTidyRestore.unavailable => const Text('戻せません（復元済みなど）', style: _hintStyle),
      RapiTidyRestore.restoring => const SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(strokeWidth: 2, color: _violetButton),
        ),
      RapiTidyRestore.idle || RapiTidyRestore.failed => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (restore == RapiTidyRestore.failed)
              const Padding(
                padding: EdgeInsets.only(right: 2),
                child: Text('戻せませんでした',
                    style: TextStyle(fontSize: 11, color: _warnAmber)),
              ),
            TextButton(
              key: ValueKey('rapi-tidy-restore-$trashId'),
              style: TextButton.styleFrom(
                foregroundColor: _violetButton,
                visualDensity: VisualDensity.compact,
              ),
              onPressed: onRestore,
              child: Text(restore == RapiTidyRestore.failed ? 'もう一度' : '戻す',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
    };
    final restored = restore == RapiTidyRestore.restored;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                color: restored ? _bodyColor : const Color(0xFF6B7280),
                decoration: restored ? null : TextDecoration.lineThrough,
                decorationColor: const Color(0xFFA1A1AA),
              ),
            ),
          ),
          const SizedBox(width: 6),
          SizedBox(height: 36, child: Center(child: trailing)),
        ],
      ),
    );
  }
}
