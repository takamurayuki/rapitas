import 'package:flutter/material.dart';

// 一覧行の横スワイプ削除（右から左）と、削除の確認ダイアログ。
// バックログ（アイデア・懸念・仮説）とラピの会話の一覧（nav39）で共通に使う。

/// 一覧行の横スワイプ削除（右から左）。
///
/// rapitas-mobile の一覧行の削除は、画面の狭いスマホで行の幅を取らないよう、
/// 行に削除ボタンを常時置かずにこの方式で行う。見た目は通知画面の Dismissible
/// （赤背景＋白いゴミ箱アイコン、右寄せ）に合わせている。
///
/// NOTE: 通知画面はスワイプしたら確認なしで即削除するが、バックログ（アイデア・懸念・仮説）の
/// 削除は元に戻せないので意図的に違う流れにしている。[onConfirmDelete] で確認ダイアログ→削除リクエストまで
/// 済ませ、成功したときだけ true を返して行を消す。キャンセル・失敗・実行中は false を返し、
/// 行はスワイプ前の位置に戻る（失敗した行が一度画面から消えて再取得で戻る、ということが起きない）。
class BacklogSwipeToDelete extends StatelessWidget {
  /// 行を識別するキー（Dismissible の key。一覧内で一意にする）
  final Key itemKey;

  /// 確認ダイアログ→削除リクエストを行い、削除できたら true
  final Future<bool> Function() onConfirmDelete;

  /// 行が消えきった後に呼ぶ（再取得が終わるまで、画面側で行を一覧から外しておく）
  final VoidCallback onDismissed;

  /// 削除リクエスト中。背景のアイコンを進捗表示に変える
  final bool deleting;

  final Widget child;

  const BacklogSwipeToDelete({
    super.key,
    required this.itemKey,
    required this.onConfirmDelete,
    required this.onDismissed,
    required this.child,
    this.deleting = false,
  });

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: itemKey,
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        color: Colors.red,
        child: deleting
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.delete, color: Colors.white),
      ),
      confirmDismiss: (_) => onConfirmDelete(),
      onDismissed: (_) => onDismissed(),
      child: child,
    );
  }
}

/// 削除の確認ダイアログ。削除するなら true。
Future<bool> confirmBacklogDelete(BuildContext context, String message) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('削除しますか？'),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('キャンセル'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.error,
          ),
          child: const Text('削除'),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}
