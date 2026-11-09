import 'package:flutter/material.dart';

/// 空・エラーのときの中央表示。引っ張って更新できるようスクロール可能にしてある。
class CenteredMessage extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String message;
  final Widget? action;

  const CenteredMessage({
    super.key,
    required this.icon,
    required this.message,
    this.iconColor = Colors.grey,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(icon, size: 64, color: iconColor),
                    const SizedBox(height: 16),
                    Text(message, textAlign: TextAlign.center),
                    if (action != null) ...[
                      const SizedBox(height: 16),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
