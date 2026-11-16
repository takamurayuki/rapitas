/// NoteContentMarkdown
///
/// Renders a note body as Markdown with the task-description renderer, but
/// shows Mermaid fences as plain code with a caption that the diagram is only
/// drawn on the PC (Mermaid has no renderer in the mobile app).
/// It does NOT scroll by itself — the parent list owns scrolling.
library;

import 'package:flutter/material.dart';
import 'task_description_markdown.dart';

/// Caption shown under a Mermaid block. 図は Web（PC）でだけ描ける。
const String mermaidPcOnlyCaption = '図は PC で表示されます';

/// One run of a note body: either ordinary Markdown or a Mermaid fence body.
class NoteSegment {
  /// Markdown source, or the Mermaid source without its fence lines.
  final String text;

  /// Whether [text] is the inside of a ```mermaid fence.
  final bool isMermaid;

  const NoteSegment(this.text, {this.isMermaid = false});
}

final RegExp _fenceOpen = RegExp(r'^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)');

/// Splits [source] into Markdown runs and Mermaid fence bodies.
///
/// Fences are tracked line by line so a ```mermaid line inside another code
/// block stays part of that block, and a closing fence must use the same
/// character and be at least as long as the opening one (CommonMark).
/// An unclosed Mermaid fence runs to the end of the note.
///
/// @param source - the note's Markdown / ノート本文の Markdown
/// @returns segments in source order; empty Markdown runs are dropped / 本文の区切り
List<NoteSegment> splitMermaidBlocks(String source) {
  final segments = <NoteSegment>[];
  final buffer = <String>[];
  String? fence; // the fence currently open (any language), e.g. '```'
  var inMermaid = false;

  void flush({required bool mermaid}) {
    final text = buffer.join('\n');
    buffer.clear();
    if (mermaid || text.trim().isNotEmpty) segments.add(NoteSegment(text, isMermaid: mermaid));
  }

  for (final line in source.split('\n')) {
    if (fence == null) {
      final match = _fenceOpen.firstMatch(line);
      if (match != null) {
        fence = match.group(1);
        if (match.group(2)!.toLowerCase() == 'mermaid') {
          flush(mermaid: false);
          inMermaid = true;
          continue;
        }
      }
      buffer.add(line);
      continue;
    }
    final open = fence;
    final closing = line.trim();
    final closes = closing.length >= open.length &&
        closing.split('').every((c) => c == open[0]);
    if (closes) {
      fence = null;
      if (inMermaid) {
        flush(mermaid: true);
        inMermaid = false;
        continue;
      }
    }
    buffer.add(line);
  }
  flush(mermaid: inMermaid);
  return segments;
}

/// Markdown rendering of a note body, with Mermaid shown as code.
class NoteContentMarkdown extends StatelessWidget {
  /// Markdown source of the note.
  final String data;

  const NoteContentMarkdown({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final segments = splitMermaidBlocks(data);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < segments.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          segments[i].isMermaid
              ? MermaidCodeBlock(source: segments[i].text)
              : TaskDescriptionMarkdown(data: segments[i].text),
        ],
      ],
    );
  }
}

/// A Mermaid diagram's source in a code box, captioned as PC-only.
class MermaidCodeBlock extends StatelessWidget {
  /// The diagram source without fence lines.
  final String source;

  const MermaidCodeBlock({super.key, required this.source});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final body = theme.textTheme.bodyMedium!;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    return Column(
      key: const ValueKey('note-mermaid-block'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          // Long diagram lines scroll sideways instead of wrapping into nonsense.
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SelectableText(
              source,
              style: body.copyWith(
                fontFamily: 'monospace',
                fontSize: body.fontSize! * 0.9,
                color: scheme.onSurface,
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Icon(Icons.desktop_windows_outlined, size: 14, color: scheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Expanded(child: Text(mermaidPcOnlyCaption, style: muted)),
          ],
        ),
      ],
    );
  }
}
