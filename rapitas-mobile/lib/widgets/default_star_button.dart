import 'package:flutter/material.dart';

/// ☆（既定のカテゴリ／テーマ）のトグルボタン。PC 版のカテゴリ・テーマ画面の Star ボタンに揃え、
/// 既定は塗りつぶし（プライマリ色）、それ以外は輪郭（控えめな色）で出す。
///
/// 既定を外す API は無い（別の行を ☆ にすると移る）ので、既定の行を押しても何もしない。
class DefaultStarButton extends StatelessWidget {
  final bool isDefault;

  /// ☆ にする操作。null なら押せない（保存中など）
  final VoidCallback? onSetDefault;

  const DefaultStarButton({super.key, required this.isDefault, required this.onSetDefault});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return IconButton(
      icon: Icon(isDefault ? Icons.star : Icons.star_border),
      color: isDefault ? colors.primary : colors.onSurfaceVariant,
      tooltip: isDefault ? 'デフォルト' : 'デフォルトに設定',
      // NOTE: 既定の行で onPressed を null にすると無効色（灰色）になり ☆ が目立たなくなるので、空の処理を渡す
      onPressed: isDefault ? () {} : onSetDefault,
    );
  }
}
