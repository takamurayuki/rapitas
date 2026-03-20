/**
 * code-block
 *
 * Public API barrel for the note editor's code-block feature.
 * Re-exports from the three sub-modules so existing callers need no changes.
 *
 * Sub-modules:
 *   - code-block-highlight  : syntax highlighting
 *   - code-block-indent     : indentation helpers
 *   - code-block-dom        : DOM fragment construction
 */

export { highlightCode } from './code-block-highlight';
export {
  getCurrentLine,
  getIndentation,
  getIndentString,
  shouldAutoIndent,
} from './code-block-indent';
export { createCodeBlockNode } from './code-block-dom';
