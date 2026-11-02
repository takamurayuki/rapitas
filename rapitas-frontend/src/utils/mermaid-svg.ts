/**
 * mermaid-svg
 *
 * Sanitizes the SVG string mermaid.render produces before it is mounted as
 * raw HTML. Not responsible for rendering or for mermaid's own configuration.
 */
import DOMPurify from 'dompurify';

/**
 * DOMPurify config for Mermaid's SVG output. Flowchart/class labels are HTML
 * inside <foreignObject>; without the integration point DOMPurify drops them.
 * Checked lossless against real mermaid output for flowchart, sequence, class,
 * gantt and pie diagrams (same tags, attributes and text before and after).
 */
const MERMAID_SVG_PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignObject'],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
};

/**
 * Remove script, event handlers and javascript: URLs from a Mermaid SVG.
 *
 * NOTE: Mermaid's securityLevel 'strict' already sanitizes, but its sanitizer
 * has had bypasses, and the source here is user/agent-written text mounted as
 * raw HTML — so a second, independent sanitizer guards the sink (#1390).
 *
 * @param svg - SVG markup from mermaid.render / mermaid.render の SVG 文字列
 * @returns Sanitized markup safe to mount as HTML / 安全化したマークアップ
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, MERMAID_SVG_PURIFY_CONFIG);
}
