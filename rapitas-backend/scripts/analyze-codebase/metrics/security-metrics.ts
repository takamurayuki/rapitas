/**
 * analyze-codebase/metrics/security-metrics
 *
 * Scans TypeScript/TSX source files for common security anti-patterns such as
 * hardcoded secrets, SQL injection vectors, XSS risks, and command injection.
 * False-positive reduction rules are applied per pattern.
 */

import type { FileInfo, SecurityFinding, AnalysisResult } from '../types';

/** Pattern definition for a single security check. */
interface SecurityPattern {
  regex: RegExp;
  type: string;
  message: string;
  severity: SecurityFinding['severity'];
  /** Lines matching any of these patterns are considered false positives. */
  excludePatterns?: RegExp[];
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    regex: /(?:password|secret|apikey|api_key|token)\s*=\s*["'][A-Za-z0-9+/=_-]{16,}["']/i,
    type: 'hardcoded_secret',
    message: 'Potential hardcoded secret or credential',
    severity: 'high',
    excludePatterns: [
      /\*{3,}/,
      /placeholder/i,
      /example/i,
      /your[-_]?/i,
      /process\.env/,
      /Bun\.env/,
    ],
  },
  {
    regex: /\beval\s*\([^)]/,
    type: 'eval_usage',
    message: 'Use of eval() - potential code injection risk',
    severity: 'high',
    excludePatterns: [/["'`].*eval/, /regex/i, /pattern/i, /message.*eval/i],
  },
  {
    regex: /dangerouslySetInnerHTML\s*=\s*\{\{/,
    type: 'xss_risk',
    message: 'dangerouslySetInnerHTML usage - potential XSS risk. Ensure content is sanitized.',
    severity: 'medium',
    excludePatterns: [/["'`].*dangerouslySetInnerHTML/, /regex/i],
  },
  {
    regex: /\$\(|`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s+.*\$\{/i,
    type: 'sql_injection',
    message: 'Potential SQL injection via string interpolation in SQL query',
    severity: 'high',
  },
  {
    regex: /(?:execSync|exec|spawn|spawnSync)\s*\(\s*`[^`]*\$\{/,
    type: 'command_injection',
    message: 'Template literal in child process - verify input is not user-controlled',
    severity: 'medium',
    excludePatterns: [/where\s+\$\{/, /which\s+\$\{/],
  },
  {
    regex: /new\s+RegExp\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
    type: 'regex_injection',
    message: 'User input in RegExp constructor - potential ReDoS',
    severity: 'medium',
  },
  {
    regex: /cors\s*\(\s*\{\s*origin\s*:\s*["'`]\*["'`]/,
    type: 'cors_wildcard',
    message: 'CORS wildcard origin - allows any domain',
    severity: 'medium',
  },
  {
    regex: /\.writeFile(?:Sync)?\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
    type: 'path_traversal',
    message: 'User input in file write path - potential path traversal',
    severity: 'high',
  },
  {
    regex: /(?:readFile|readFileSync|createReadStream)\s*\(\s*(?:req\.|params\.|query\.|body\.)/,
    type: 'path_traversal',
    message: 'User input in file read path - potential path traversal',
    severity: 'medium',
  },
  {
    regex: /(?:JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY)\s*=\s*["'][A-Za-z0-9+/=_-]{8,}["']/,
    type: 'hardcoded_key',
    message: 'Hardcoded cryptographic key or session secret',
    severity: 'critical',
    excludePatterns: [/process\.env/, /Bun\.env/, /import\.meta\.env/],
  },
];

/**
 * Scans TypeScript source files for security anti-patterns.
 *
 * @param files - All scanned FileInfo entries / スキャン済みFileInfo一覧
 * @returns Security findings with severity summary / セキュリティ検出結果と重要度サマリ
 */
export function collectSecurityFindings(files: FileInfo[]): AnalysisResult['security'] {
  const findings: SecurityFinding[] = [];
  const tsFiles = files.filter((f) => f.ext === '.ts' || f.ext === '.tsx');

  for (const f of tsFiles) {
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      // Skip lines marked as security-reviewed (check within 3 preceding lines)
      const checkRange = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (/SECURITY:\s*(?:safe|reviewed|verified|ok)/i.test(checkRange)) continue;

      const isTest = f.relativePath.match(/\.(test|spec)\./);
      const isDemo =
        f.relativePath.includes('demo') ||
        f.relativePath.includes('example') ||
        f.relativePath.includes('stories');

      for (const p of SECURITY_PATTERNS) {
        if (isTest && (p.type === 'hardcoded_secret' || p.type === 'hardcoded_key')) continue;
        if (isDemo && (p.type === 'eval_usage' || p.type === 'xss_risk')) continue;
        if (p.regex.test(line)) {
          // Skip type definitions and interface declarations
          if (/^\s*(type|interface)\s/.test(line)) continue;
          // Skip lines that are regex/pattern definitions (avoid self-detection)
          if (
            /regex\s*[:=]|new\s+RegExp|\/.*\/[gimsuy]*/.test(line) &&
            p.type !== 'regex_injection'
          )
            continue;
          // Skip log/message/error strings (template literals used in logging, not SQL)
          if (
            p.type === 'sql_injection' &&
            /log\.|logger\.|console\.|message|error|info|debug|warn/.test(line)
          )
            continue;
          // Apply exclude patterns
          if (p.excludePatterns?.some((ep) => ep.test(line))) continue;

          findings.push({
            file: f.relativePath,
            line: i + 1,
            type: p.type,
            message: p.message,
            severity: p.severity,
            snippet: line.trim().substring(0, 120),
          });
        }
      }
    }
  }

  const summary = {
    high: findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };

  return { findings, summary };
}
