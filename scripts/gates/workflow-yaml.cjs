/**
 * workflow-yaml
 *
 * A deliberately small block-YAML reader for GitHub Actions workflow files, so
 * the quality-gates check needs no new dependency (the repo has no YAML parser
 * installed at the root). It supports what workflows use: block mappings and
 * sequences, plain/quoted scalars, flow `[...]`/`{...}` collections, block
 * scalars (`|`, `>`) and multi-line plain scalars. It does NOT support anchors,
 * aliases, tags or multiple documents — parseYaml throws on anchors/aliases so
 * an unsupported construct fails loudly instead of being misread.
 */
'use strict';

/**
 * Strip a trailing `# comment` that sits outside quotes.
 *
 * @param {string} text - One line of YAML / YAML の1行
 * @returns {string} The line without its comment / コメントを除いた行
 */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/** Index of the `key: value` separator outside quotes/brackets, or -1. */
function findKeySeparator(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0 && (i + 1 === text.length || text[i + 1] === ' ')) return i;
  }
  return -1;
}

/** Split a flow collection body on top-level commas. */
function splitFlow(body) {
  const parts = [];
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/**
 * Parse one scalar or flow collection.
 *
 * @param {string} raw - The value text after `key:` or `- ` / 値の文字列
 * @returns {unknown} string | boolean | null | array | object / 解析結果
 */
function parseScalar(raw) {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return JSON.parse(text);
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitFlow(text.slice(1, -1)).map(parseScalar);
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const out = {};
    for (const part of splitFlow(text.slice(1, -1))) {
      const sep = findKeySeparator(part);
      if (sep === -1) out[String(parseScalar(part))] = null;
      else out[String(parseScalar(part.slice(0, sep)))] = parseScalar(part.slice(sep + 1));
    }
    return out;
  }
  // Numbers stay strings: check names render them verbatim (`Build (18)`).
  return text;
}

/** Turn source text into significant lines, folding block scalars into one line. */
function tokenize(source) {
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (/^\s*(#.*)?$/.test(raw) || /^(---|\.\.\.)\s*$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const lineNo = i + 1;
    let text = stripComment(raw.trim());
    // A value of `|`, `>-`, etc. opens a block scalar: swallow its deeper lines.
    if (/(^|:\s+|^-\s+)[|>][-+0-9]*$/.test(text)) {
      const body = [];
      while (i + 1 < rawLines.length) {
        const next = rawLines[i + 1];
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() !== '' && nextIndent <= indent) break;
        body.push(next.trim());
        i++;
      }
      text = text.replace(/[|>][-+0-9]*$/, JSON.stringify(body.join('\n').trim()));
    }
    lines.push({ indent, text, line: lineNo });
  }
  return lines;
}

/**
 * Parse workflow YAML into plain JS values.
 *
 * @param {string} source - YAML text / YAML テキスト
 * @returns {unknown} The parsed document / 解析結果
 * @throws {Error} On anchors/aliases or an unparseable structure / 非対応構文や解析不能時
 */
function parseYaml(source) {
  const lines = tokenize(source);
  let pos = 0;
  const isSeqItem = (text) => text === '-' || text.startsWith('- ');

  function readValue(rawValue, parentIndent) {
    let value = rawValue;
    if (/^[&*][A-Za-z0-9_-]/.test(value)) {
      throw new Error(`line ${lines[pos - 1].line}: YAML anchors/aliases are not supported`);
    }
    // Continuation lines: unbalanced flow brackets or a multi-line plain scalar.
    while (pos < lines.length && lines[pos].indent > parentIndent) {
      const open = (value.match(/[[{]/g) || []).length - (value.match(/[\]}]/g) || []).length;
      const isPlain = !/^["'[{]/.test(value);
      if (open <= 0 && !isPlain) break;
      value += (open > 0 ? '' : ' ') + lines[pos].text;
      pos++;
    }
    return parseScalar(value);
  }

  function parseBlock(indent) {
    return isSeqItem(lines[pos].text) ? parseSequence(indent) : parseMapping(indent);
  }

  function parseChild(keyIndent, allowSameIndentSequence) {
    if (pos >= lines.length) return null;
    const next = lines[pos];
    if (next.indent > keyIndent) return parseBlock(next.indent);
    if (allowSameIndentSequence && next.indent === keyIndent && isSeqItem(next.text)) {
      return parseSequence(keyIndent);
    }
    return null;
  }

  function parseMapping(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !isSeqItem(lines[pos].text)) {
      const { text, line } = lines[pos];
      const sep = findKeySeparator(text);
      if (sep === -1) throw new Error(`line ${line}: expected "key: value", got "${text}"`);
      const key = String(parseScalar(text.slice(0, sep)));
      const rest = text.slice(sep + 1).trim();
      pos++;
      out[key] = rest === '' ? parseChild(indent, true) : readValue(rest, indent);
    }
    return out;
  }

  function parseSequence(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && isSeqItem(lines[pos].text)) {
      const current = lines[pos];
      const rest = current.text === '-' ? '' : current.text.slice(2).trim();
      if (rest === '') {
        pos++;
        out.push(parseChild(indent, false));
      } else if (findKeySeparator(rest) !== -1 && !/^["'[{]/.test(rest)) {
        // `- key: value` starts a mapping whose keys align with `key`.
        const offset = current.text.length - current.text.slice(1).trimStart().length;
        lines[pos] = { indent: indent + offset, text: rest, line: current.line };
        out.push(parseMapping(indent + offset));
      } else {
        pos++;
        out.push(readValue(rest, indent));
      }
    }
    return out;
  }

  if (lines.length === 0) return null;
  const doc = parseBlock(lines[0].indent);
  if (pos < lines.length) {
    throw new Error(`line ${lines[pos].line}: unexpected indentation "${lines[pos].text}"`);
  }
  return doc;
}

module.exports = { parseYaml, parseScalar, stripComment };
