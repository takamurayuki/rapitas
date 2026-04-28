import { describe, it, expect } from 'vitest';
import {
  validateRequired,
  validateName,
  validateUrl,
  validateApiKey,
  validateClaudeApiKey,
  validateNumber,
  collectErrors,
} from '../validation';

describe('validateRequired', () => {
  it('returns valid for non-empty string', () => {
    expect(validateRequired('hello', 'Field')).toEqual({ valid: true });
  });

  it('returns invalid for empty string', () => {
    const result = validateRequired('', 'Field');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Field');
  });

  it('returns invalid for whitespace-only string', () => {
    expect(validateRequired('   ', 'Name').valid).toBe(false);
  });
});

describe('validateName', () => {
  it('returns valid for normal name', () => {
    expect(validateName('Task Name').valid).toBe(true);
  });

  it('returns invalid for empty name', () => {
    expect(validateName('').valid).toBe(false);
  });

  it('respects minLength', () => {
    expect(validateName('ab', 'Name', 3).valid).toBe(false);
    expect(validateName('abc', 'Name', 3).valid).toBe(true);
  });

  it('respects maxLength', () => {
    expect(validateName('a'.repeat(101), 'Name', 1, 100).valid).toBe(false);
    expect(validateName('a'.repeat(100), 'Name', 1, 100).valid).toBe(true);
  });

  it('trims whitespace before validation', () => {
    expect(validateName('  ab  ', 'Name', 3).valid).toBe(false);
    expect(validateName('  abc  ', 'Name', 3).valid).toBe(true);
  });
});

describe('validateUrl', () => {
  it('returns valid for http URL', () => {
    expect(validateUrl('http://example.com').valid).toBe(true);
  });

  it('returns valid for https URL', () => {
    expect(validateUrl('https://example.com/path?q=1').valid).toBe(true);
  });

  it('returns invalid for ftp URL', () => {
    expect(validateUrl('ftp://example.com').valid).toBe(false);
  });

  it('returns invalid for malformed URL', () => {
    expect(validateUrl('not-a-url').valid).toBe(false);
  });

  it('returns valid for empty when not required', () => {
    expect(validateUrl('', 'URL', false).valid).toBe(true);
  });

  it('returns invalid for empty when required', () => {
    expect(validateUrl('', 'URL', true).valid).toBe(false);
  });
});

describe('validateApiKey', () => {
  it('returns valid for empty when not required', () => {
    expect(validateApiKey('').valid).toBe(true);
  });

  it('returns invalid for empty when required', () => {
    expect(validateApiKey('', undefined, true).valid).toBe(false);
  });

  it('returns invalid for key shorter than 10 chars', () => {
    expect(validateApiKey('short').valid).toBe(false);
  });

  it('validates Anthropic API key prefix', () => {
    expect(validateApiKey('sk-ant-api-test1234567890', 'anthropic-api').valid).toBe(true);
    expect(validateApiKey('wrong-prefix-1234567890', 'anthropic-api').valid).toBe(false);
  });

  it('validates OpenAI API key prefix', () => {
    expect(validateApiKey('sk-1234567890abcdef', 'openai').valid).toBe(true);
    expect(validateApiKey('wrong1234567890abc', 'openai').valid).toBe(false);
  });

  it('validates Gemini API key prefix', () => {
    expect(validateApiKey('AIza1234567890abcdef', 'gemini').valid).toBe(true);
  });

  it('accepts any key for azure-openai (no prefix)', () => {
    expect(validateApiKey('any-valid-key-here-1234', 'azure-openai').valid).toBe(true);
  });
});

describe('validateClaudeApiKey', () => {
  it('returns invalid for empty', () => {
    expect(validateClaudeApiKey('').valid).toBe(false);
  });

  it('returns invalid for short key', () => {
    expect(validateClaudeApiKey('short').valid).toBe(false);
  });

  it('returns invalid for wrong prefix', () => {
    expect(validateClaudeApiKey('sk-wrong-prefix-key').valid).toBe(false);
  });

  it('returns valid for correct Claude API key format', () => {
    expect(validateClaudeApiKey('sk-ant-api-test1234567890').valid).toBe(true);
  });
});

describe('validateNumber', () => {
  it('returns valid for number in range', () => {
    expect(validateNumber(5, 'Count', 0, 10).valid).toBe(true);
  });

  it('returns invalid for NaN', () => {
    expect(validateNumber(NaN, 'Count').valid).toBe(false);
  });

  it('returns invalid for below min', () => {
    expect(validateNumber(-1, 'Count', 0).valid).toBe(false);
  });

  it('returns invalid for above max', () => {
    expect(validateNumber(11, 'Count', 0, 10).valid).toBe(false);
  });

  it('returns valid at boundary values', () => {
    expect(validateNumber(0, 'Count', 0, 10).valid).toBe(true);
    expect(validateNumber(10, 'Count', 0, 10).valid).toBe(true);
  });
});

describe('collectErrors', () => {
  it('returns valid when all results are valid', () => {
    const result = collectErrors({ valid: true }, { valid: true });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects all error messages', () => {
    const result = collectErrors(
      { valid: false, error: 'Error 1' },
      { valid: true },
      { valid: false, error: 'Error 2' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Error 1', 'Error 2']);
  });
});
