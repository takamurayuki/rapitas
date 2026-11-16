// ラピのチャット画面の下部の入力欄（rapi_screen.dart から切り出した部品。nav39 直し回1）。
//
// 画面の定数（色・最大文字数）を共有するため part にしている。振る舞いは切り出す前と同じ。

part of 'rapi_screen.dart';

/// 下部のチャット欄（角丸の入力欄＋右端の丸いボタン）。
/// 右端のボタンは1つを出し分ける：聞き取り中は赤いマイク（押すと聞き取りを終えて送信）、
/// 文があれば送信、空ならマイク（押すと聞き取りを始める）
class _Composer extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final String placeholder;
  final bool hasText;
  final bool sending;
  final bool listening;
  final VoidCallback onSend;
  final VoidCallback onMic;

  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.placeholder,
    required this.hasText,
    required this.sending,
    required this.listening,
    required this.onSend,
    required this.onMic,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final Widget button;
    if (listening) {
      button = _RoundButton(
        key: const ValueKey('rapi-mic'),
        tooltip: '聞き取りを終える',
        color: _listeningRed,
        halo: true,
        icon: Icons.mic,
        iconColor: Colors.white,
        onTap: onMic,
      );
    } else if (hasText) {
      final canSend = !sending;
      button = _RoundButton(
        key: const ValueKey('rapi-send'),
        tooltip: '送信',
        color: canSend ? _indigo : scheme.outlineVariant,
        icon: Icons.arrow_upward,
        iconColor: Colors.white,
        onTap: canSend ? onSend : null,
      );
    } else {
      button = _RoundButton(
        key: const ValueKey('rapi-mic'),
        tooltip: '音声で入力',
        color: sending ? scheme.outlineVariant : _indigo.withValues(alpha: 0.1),
        icon: Icons.mic_none,
        iconColor: sending ? Colors.white : _indigo,
        onTap: sending ? null : onMic,
      );
    }

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Container(
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: listening ? _listeningRed.withValues(alpha: 0.5) : scheme.outlineVariant),
          ),
          padding: const EdgeInsets.fromLTRB(16, 4, 6, 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('rapi-input'),
                  controller: controller,
                  focusNode: focusNode,
                  // 聞き取り中は認識結果で欄を書き換えるので、手での入力は受けない
                  readOnly: listening,
                  minLines: 1,
                  maxLines: 5,
                  textInputAction: TextInputAction.newline,
                  inputFormatters: [LengthLimitingTextInputFormatter(_maxTextLength)],
                  style: const TextStyle(fontSize: 15),
                  decoration: InputDecoration(
                    hintText: placeholder,
                    hintMaxLines: 1,
                    hintStyle: listening ? const TextStyle(color: _listeningRed) : null,
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
                child: button,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 入力欄の右端の丸いボタン（直径40）。[halo] は聞き取り中の淡い輪
class _RoundButton extends StatelessWidget {
  final String tooltip;
  final Color color;
  final IconData icon;
  final Color iconColor;
  final VoidCallback? onTap;
  final bool halo;

  const _RoundButton({
    super.key,
    required this.tooltip,
    required this.color,
    required this.icon,
    required this.iconColor,
    required this.onTap,
    this.halo = false,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: halo
              ? [BoxShadow(color: _listeningRed.withValues(alpha: 0.2), spreadRadius: 3)]
              : null,
        ),
        child: Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 40,
              height: 40,
              child: Icon(icon, color: iconColor, size: 22),
            ),
          ),
        ),
      ),
    );
  }
}
