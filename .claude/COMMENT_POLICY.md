# COMMENT POLICY FOR AI AGENTS

## PRIME DIRECTIVE

Write WHY, not WHAT.
If the comment only restates what the code does, delete it.

---

## DECISION TREE — Should I write a comment?

```
Is this a file, public function, or exported type?
├── YES → Write a doc comment. (See Section 2)
└── NO  → Does this line/block meet ANY of the following?
           ├── A) The reason for this implementation is not obvious from the code
           ├── B) There is a constraint from an external spec or API
           ├── C) A future editor could break this by "improving" it
           └── D) This is a known issue, workaround, or unfinished work
               ├── YES to any → Write an inline comment. (See Section 3)
               └── NO to all  → Write NO comment.
```

---

## 1. LANGUAGE RULES

| Language                | File header      | Public function    | Type/Interface      |
| ----------------------- | ---------------- | ------------------ | ------------------- |
| TypeScript / JavaScript | `/** ... */`     | JSDoc `/** ... */` | JSDoc per field     |
| Rust                    | `//! ...`        | `/// ...`          | `/// ...` per field |
| Python                  | `""" ... """`    | docstring          | inline `#`          |
| Go                      | `// Package ...` | `// FuncName ...`  | `// FieldName ...`  |

**Write all doc comments in English.**
Add Japanese translation only for `@param` / `@returns` / `@throws` descriptions.

---

## 2. DOC COMMENT TEMPLATES

### File Header (ALL files, no exceptions)

```typescript
/**
 * <ModuleName>
 *
 * <One sentence: what this module is responsible for.>
 * <One sentence: what it is NOT responsible for, if non-obvious.>
 */
```

```rust
//! <ModuleName>
//!
//! <One sentence: what this module is responsible for.>
```

```python
"""
<module_name>.py

<One sentence: what this module is responsible for.>
"""
```

### Public Function

**Write JSDoc/rustdoc IF any of the following:**

- Has 1+ parameters
- Return type is not `void` / `()` / `None`
- Can throw / return an error

**Skip doc comment if:** function name + types are fully self-explanatory AND none of the above apply.

```typescript
/**
 * <One sentence describing the purpose, not the implementation.>
 *
 * @param paramName - <what it is> / <日本語説明>
 * @returns <what it returns> / <日本語説明>
 * @throws {ErrorType} <when this is thrown> / <日本語説明>
 */
```

```rust
/// <One sentence describing the purpose.>
///
/// # Arguments
/// * `param` - <what it is> / <日本語説明>
///
/// # Errors
/// Returns `ErrorType` when <condition>. / <条件>の場合に返す。
```

```python
def func(param: str) -> int:
    """
    <One sentence describing the purpose.>

    Args:
        param: <what it is> / <日本語説明>

    Returns:
        <what it returns> / <日本語説明>

    Raises:
        ValueError: <when> / <条件>
    """
```

---

## 3. INLINE COMMENT RULES

### Format

```
// <Reason in one sentence.> (<context if needed>)
```

### Good vs Bad — Memorize these patterns

```typescript
// ❌ NEVER — restates the code
const count = agents.length; // get the length of agents

// ✅ ALWAYS — explains why
const count = agents.length; // cached to avoid O(n) on every loop iteration

// ❌ NEVER — obvious initialization
let retries = 0; // initialize to 0

// ✅ ALWAYS — external constraint
const MAX_TOKENS = 8192; // Claude API hard limit per system prompt

// ❌ NEVER — describes the call
await agent.stop(); // call stop

// ✅ ALWAYS — non-obvious ordering or side effect
await agent.stop(); // must complete before releasing the port; stop() is not idempotent
```

---

## 4. TAG CONVENTION

Use ONLY these four tags.

| Tag     | Use when                                   |
| ------- | ------------------------------------------ |
| `TODO`  | Work that must be done later               |
| `FIXME` | Known bug or incorrect behavior            |
| `NOTE`  | Critical context a future editor must know |
| `HACK`  | Temporary workaround; must be revisited    |

```typescript
// TODO: Summarization fallback not implemented — will exceed context on large tasks.
// FIXME: Not thread-safe; assumes single-threaded execution.
// NOTE: Claude API returns 529 under high load; retry logic is intentional.
// HACK: Workaround for pino v9 breaking change — revert after upgrading to v10.
```

---

## 5. AGENT-SPECIFIC OBLIGATIONS

### 5-1. Always explain WHY you changed something

```typescript
// NOTE: Replaced forEach with for...of — await is not supported inside forEach callbacks.
for (const agent of agents) {
  await agent.stop();
}
```

### 5-2. Always explain WHY you deleted something

```typescript
// NOTE: Removed null check — TypeScript strict mode guarantees non-null at this call site.
```

### 5-3. Flag uncertain implementations immediately

```typescript
// FIXME: Spec undefined for empty agentId — currently falls back to auto-select.
```

### 5-4. Flag all external spec dependencies

```typescript
// NOTE: pino v9+ changed default log level from 'info' to 'trace'. Pin version if behavior changes.
// NOTE: freee API rate limit is 500 req/min per token. Batch calls accordingly.
```

---

## 6. ANTI-PATTERNS — Never do these

```typescript
// ❌ Timestamped edit logs — use git
// Updated on 2025-01-01

// ❌ Obvious type restatement
const name: string = "rapitas"; // string

// ❌ Disabled code without explanation
// await agent.reset();

// ✅ Disabled code WITH explanation
// await agent.reset(); // NOTE: Disabled — reset() clears token budget mid-task. Re-enable after #142.

// ❌ Vague intent
// TODO: Fix this later

// ✅ Specific and actionable
// TODO: Add exponential backoff — currently fails immediately on rate limit (HTTP 429).
```

---

## QUICK REFERENCE

```
File created?          → Add file header (always)
Public function?       → Add doc comment (if params / return / throws exist)
Code not obvious?      → Add inline WHY comment
Code changed?          → Add NOTE above the change
Code deleted?          → Add NOTE explaining why
Spec unclear?          → Add FIXME
Workaround?            → Add HACK
Obvious code?          → Add NOTHING
```
