import 'package:flutter/material.dart';
import '../../models/rapi.dart';
import '../../providers/rapi_chat_provider.dart';

// 「伴走して」「伴走をやめて」の確認カード（設計 4.3「手動のタスク」）。
//
// 確認待ち：対象のタスク・伴走すると何が変わるか・「伴走を始める／やめる」「やめる」
// 反映後：1行の結果と「タスクを開く」
// 結果不明：押し直させず、タスクで確かめてもらう
// 見た目は変更カード（rapi_screen.dart の _ChangeCard）にそろえる。

const _violetBg = Color(0xFFF5F3FF);
const _violetBorder = Color(0xFFDDD6FE);
const _violetButton = Color(0xFF7C3AED);
const _labelStyle = TextStyle(fontSize: 12, color: Color(0xFF6B7280));
const _bodyColor = Color(0xFF18181B);
const _warnAmber = Color(0xFFB45309);

class RapiCompanionCardView extends StatelessWidget {
  final RapiCompanionCard card;
  final VoidCallback onApply;
  final VoidCallback onCancel;
  final VoidCallback onOpen;

  const RapiCompanionCardView({
    super.key,
    required this.card,
    required this.onApply,
    required this.onCancel,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final p = card.proposal;
    final start = p.action == RapiCompanionAction.start;
    final phase = card.phase;
    final proposed = phase == RapiCompanionPhase.proposed || phase == RapiCompanionPhase.applying;
    final heading = switch (phase) {
      RapiCompanionPhase.proposed || RapiCompanionPhase.applying =>
        start ? 'このタスクを伴走しますか' : 'このタスクの伴走をやめますか',
      RapiCompanionPhase.applied => start ? '伴走を始めました' : '伴走をやめました',
      RapiCompanionPhase.applyUnknown => '反映できたか確かめられませんでした',
    };
    final headingColor = phase == RapiCompanionPhase.applyUnknown ? _warnAmber : _violetButton;
    final explanation = start
        ? 'ラピが進み具合を見守るタスクとして記録します。'
            '完了かどうかは、これまでどおり完了ゲートと陪審が判定します。'
        : '伴走をやめると、ラピはこのタスクを追いかけなくなります。タスク自体は変わりません。'
            'また始めるときは「伴走して」と送ってください。';

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
                  child: Icon(
                    phase == RapiCompanionPhase.applyUnknown ? Icons.help_outline : Icons.check_circle,
                    size: 16,
                    color: headingColor,
                  ),
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
          const SizedBox(height: 10),
          const Text('対象', style: _labelStyle),
          const SizedBox(height: 2),
          Text(p.title,
              style: const TextStyle(
                  fontSize: 15, color: _bodyColor, fontWeight: FontWeight.w600, height: 1.4)),
          if (proposed) ...[
            const SizedBox(height: 8),
            Text(explanation, style: _labelStyle.copyWith(height: 1.5)),
          ],
          if (phase == RapiCompanionPhase.applied)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                start
                    ? 'ラピが進み具合を見守るタスクとして記録しました。'
                    : '伴走の記録を閉じました（いつ・なぜ閉じたかは残ります）。',
                style: const TextStyle(fontSize: 12, color: Color(0xFF047857), height: 1.4),
              ),
            ),
          if (phase == RapiCompanionPhase.applyUnknown)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                '応答がなく、反映されたか確かめられませんでした。反映済みの場合もあるため、'
                'ここからは押し直せません。相談で「伴走して」「伴走をやめて」と送ると、今の状態が分かります。',
                style: TextStyle(fontSize: 12, color: _warnAmber, height: 1.4),
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
                    key: const ValueKey('rapi-companion-apply'),
                    style: FilledButton.styleFrom(
                      backgroundColor: _violetButton,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: _violetButton.withValues(alpha: 0.4),
                      disabledForegroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: phase == RapiCompanionPhase.applying ? null : onApply,
                    child: Text(phase == RapiCompanionPhase.applying
                        ? '反映しています…'
                        : start
                            ? '伴走を始める'
                            : '伴走をやめる'),
                  ),
                ),
                const SizedBox(width: 8),
                TextButton(
                  key: const ValueKey('rapi-companion-cancel'),
                  style: TextButton.styleFrom(foregroundColor: const Color(0xFF6B7280)),
                  onPressed: phase == RapiCompanionPhase.applying ? null : onCancel,
                  child: const Text('やめる'),
                ),
              ],
            )
          else
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                style: TextButton.styleFrom(foregroundColor: _violetButton),
                onPressed: onOpen,
                child: const Text('タスクを開く'),
              ),
            ),
        ],
      ),
    );
  }
}
