import 'package:flutter/material.dart';
import '../utils/color_utils.dart';

/// テーマ・カテゴリで選べる色のプリセット（先頭はテーマのデフォルト色）
const List<String> presetSwatchColors = [
  '#8B5CF6', // violet（テーマのデフォルト色）
  '#6366F1', // indigo
  '#3B82F6', // blue
  '#06B6D4', // cyan
  '#10B981', // emerald
  '#84CC16', // lime
  '#F59E0B', // amber
  '#F97316', // orange
  '#EF4444', // red
  '#EC4899', // pink
  '#64748B', // slate
];

final RegExp _hexColorPattern = RegExp(r'^#?([0-9a-fA-F]{6})$');

/// 色の比較用に '#RRGGBB'（大文字）へ正規化する。6桁の16進でなければ null
String? normalizeSwatchColor(String? color) {
  if (color == null) return null;
  final match = _hexColorPattern.firstMatch(color.trim());
  if (match == null) return null;
  return '#${match.group(1)!.toUpperCase()}';
}

/// 色見本の一覧。[selected] がプリセットに無い色（既存データの任意色）なら、
/// 先頭に追加して選択状態で見せる（編集で開いただけで色が変わらないように）。
List<String> swatchColorsFor(String? selected) {
  final normalized = normalizeSwatchColor(selected);
  if (normalized == null || presetSwatchColors.contains(normalized)) {
    return presetSwatchColors;
  }
  return [normalized, ...presetSwatchColors];
}

/// プリセットの色見本から1色を選ぶ部品（テーマ・カテゴリのフォームで共用）
class ColorSwatchPicker extends StatelessWidget {
  /// 選択中の色（'#RRGGBB'）
  final String? selected;
  final ValueChanged<String> onChanged;

  const ColorSwatchPicker({
    super.key,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final selectedNormalized = normalizeSwatchColor(selected);
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final hex in swatchColorsFor(selected))
          _Swatch(
            color: ColorUtils.parseColor(hex) ?? Colors.grey,
            selected: hex == selectedNormalized,
            ringColor: scheme.onSurface,
            onTap: () => onChanged(hex),
          ),
      ],
    );
  }
}

class _Swatch extends StatelessWidget {
  final Color color;
  final bool selected;
  final Color ringColor;
  final VoidCallback onTap;

  const _Swatch({
    required this.color,
    required this.selected,
    required this.ringColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // 明るい色の上では黒、暗い色の上では白のチェック
    final checkColor =
        ThemeData.estimateBrightnessForColor(color) == Brightness.dark
            ? Colors.white
            : Colors.black;
    return Semantics(
      button: true,
      selected: selected,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? ringColor : Colors.transparent,
              width: 2,
            ),
          ),
          padding: const EdgeInsets.all(3),
          child: DecoratedBox(
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: selected
                ? Icon(Icons.check, size: 18, color: checkColor)
                : null,
          ),
        ),
      ),
    );
  }
}
