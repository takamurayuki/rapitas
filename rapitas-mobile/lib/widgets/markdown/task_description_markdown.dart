/// TaskDescriptionMarkdown
///
/// Renders a task description as GitHub-flavored Markdown inside the task
/// detail screen, styled from the app theme and opening links externally.
/// It does NOT scroll by itself — the parent list owns scrolling.
library;

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens [uri] outside the app and reports whether it succeeded.
typedef MarkdownLinkLauncher = Future<bool> Function(Uri uri);

/// Schemes a description link may open. Everything else (javascript:, file:,
/// intent:, relative paths …) is refused because descriptions can be written
/// by AI agents, not only by the user.
const Set<String> allowedMarkdownLinkSchemes = {'http', 'https', 'mailto'};

/// Converts a Markdown link target into a URI that is safe to open.
///
/// @param href - raw link target from the Markdown source / Markdown 上のリンク先
/// @returns the parsed URI, or null when it is empty, unparsable or uses a
///   scheme outside [allowedMarkdownLinkSchemes] / 開けない場合は null
Uri? parseLaunchableLink(String? href) {
  final trimmed = href?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  final uri = Uri.tryParse(trimmed);
  if (uri == null || !allowedMarkdownLinkSchemes.contains(uri.scheme.toLowerCase())) {
    return null;
  }
  // "https:" alone parses but has nowhere to go.
  if (uri.scheme.toLowerCase() != 'mailto' && uri.host.isEmpty) return null;
  return uri;
}

Future<bool> _launchExternally(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// Builds the Markdown style sheet from [theme] so text keeps the size and
/// colour of the former plain description and stays readable in dark mode.
///
/// @param theme - the active app theme / 現在のアプリテーマ
/// @returns style sheet for [TaskDescriptionMarkdown] / 説明表示用のスタイル
MarkdownStyleSheet buildTaskDescriptionStyleSheet(ThemeData theme) {
  final scheme = theme.colorScheme;
  final text = theme.textTheme;
  // The former Text() inherited bodyMedium from Material's DefaultTextStyle.
  final body = text.bodyMedium!;
  final codeBackground = scheme.surfaceContainerHighest;

  return MarkdownStyleSheet.fromTheme(theme).copyWith(
    p: body,
    a: body.copyWith(
      color: scheme.primary,
      decoration: TextDecoration.underline,
      decorationColor: scheme.primary,
    ),
    // Headings stay at or below the task title (headlineSmall) so the
    // description never visually outranks it.
    h1: text.titleLarge?.copyWith(fontWeight: FontWeight.bold),
    h2: text.titleMedium?.copyWith(fontWeight: FontWeight.bold),
    h3: text.titleSmall?.copyWith(fontWeight: FontWeight.bold),
    h4: body.copyWith(fontWeight: FontWeight.bold),
    h5: body.copyWith(fontWeight: FontWeight.bold),
    h6: body.copyWith(fontWeight: FontWeight.bold, color: scheme.onSurfaceVariant),
    code: body.copyWith(
      fontFamily: 'monospace',
      fontSize: body.fontSize! * 0.9,
      color: scheme.onSurface,
      backgroundColor: codeBackground,
    ),
    codeblockPadding: const EdgeInsets.all(12),
    codeblockDecoration: BoxDecoration(
      color: codeBackground,
      borderRadius: BorderRadius.circular(8),
    ),
    blockquote: body.copyWith(color: scheme.onSurfaceVariant),
    blockquoteDecoration: BoxDecoration(
      color: scheme.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(4),
      border: Border(left: BorderSide(color: scheme.primary, width: 3)),
    ),
    // ThemeData.primaryColor is not the seed colour in dark mode.
    checkbox: body.copyWith(color: scheme.primary),
    listBullet: body,
    tableHead: body.copyWith(fontWeight: FontWeight.w600),
    tableBody: body,
    tableBorder: TableBorder.all(color: scheme.outlineVariant),
    tableHeadAlign: TextAlign.start,
    tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
    horizontalRuleDecoration: BoxDecoration(
      border: Border(top: BorderSide(color: scheme.outlineVariant)),
    ),
  );
}

/// Markdown rendering of a task description (headings, emphasis, lists,
/// task-list checkboxes, code, quotes, links and tables).
class TaskDescriptionMarkdown extends StatelessWidget {
  /// Markdown source of the description.
  final String data;

  /// Opens a link; replaceable in tests. Defaults to the external browser.
  final MarkdownLinkLauncher launcher;

  const TaskDescriptionMarkdown({
    super.key,
    required this.data,
    this.launcher = _launchExternally,
  });

  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: data,
      // Grows inside the screen's ListView instead of adding a second scroller.
      shrinkWrap: true,
      // Stretch so code blocks and quotes get full-width backgrounds.
      fitContent: false,
      // Descriptions were shown as plain text, so single newlines must keep
      // breaking the line instead of being folded into a space.
      softLineBreak: true,
      styleSheet: buildTaskDescriptionStyleSheet(Theme.of(context)),
      onTapLink: (text, href, title) => _openLink(context, href),
    );
  }

  Future<void> _openLink(BuildContext context, String? href) async {
    final uri = parseLaunchableLink(href);
    var opened = false;
    if (uri != null) {
      try {
        opened = await launcher(uri);
      } catch (_) {
        // No handler / platform error: fall through to the same message.
        opened = false;
      }
    }
    // NOTE: The launcher can stay pending while the user leaves the detail
    // screen. Without this check a late failure would show the message on the
    // next screen, or throw once the messenger itself is disposed. The
    // messenger is therefore looked up only after the await, too.
    if (opened || !context.mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text('リンクを開けませんでした: ${href ?? ''}')),
    );
  }
}
