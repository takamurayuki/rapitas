import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { stagedSeverity } from "../eslint-shared.mjs";
import noRawPrismaInsensitive from "./eslint-rules/no-raw-prisma-insensitive.mjs";
import noUnscopedPrNumberLookup from "./eslint-rules/no-unscoped-pr-number-lookup.mjs";
import noUnguardedTaskDelete from "./eslint-rules/no-unguarded-task-delete.mjs";
import preferTestEachForSimilar from "./eslint-rules/prefer-test-each-for-similar.mjs";
import requireValidatedIdParam from "./eslint-rules/require-validated-id-param.mjs";

/** @type {import('eslint').Linter.Plugin} */
const localPlugin = {
  rules: {
    "no-raw-prisma-insensitive": noRawPrismaInsensitive,
    "no-unscoped-pr-number-lookup": noUnscopedPrNumberLookup,
    "no-unguarded-task-delete": noUnguardedTaskDelete,
    "prefer-test-each-for-similar": preferTestEachForSimilar,
    "require-validated-id-param": requireValidatedIdParam,
  },
};

export default [
  // NOTE(#1332): A STANDALONE ignores object, which is what makes it global in
  // flat config. Adding "generated/**" to the `ignores` of the block below
  // instead only removes those files from THAT block — and that block is what
  // supplies the TypeScript parser, so the generated .d.ts files fell through
  // to the `**/*.d.ts` block, got espree, and produced 6 "Parsing error:
  // Unexpected token" failures in CI. That is the same trap the comment on the
  // block below records for tests/**; it was walked into anyway.
  //
  // Why ignore them at all: `generated/` holds the two Prisma clients, emitted
  // by `prisma generate`. Linting them says nothing about code anyone wrote,
  // and a regeneration that happened to emit a violation would redden a
  // required gate for a reason nobody here controls.
  //
  // NOTE: this cannot be verified by running eslint locally in a worktree —
  // `generated/*` are symlinks to the primary checkout and eslint does not
  // traverse them, so the directory looks empty here and looks real in CI.
  // Check it with `npx eslint --print-config generated/prisma-postgres/index.d.ts`,
  // which reports the file as ignored instead of handing back espree.
  { ignores: ["generated/**"] },
  {
    files: ["**/*.ts"],
    // NOTE: tests/** must NOT be ignored here — this block supplies the TS parser.
    // Excluding it left test files on eslint's default espree parser, which chokes
    // on TS syntax (`as`, type annotations) with "Parsing error: Unexpected token",
    // producing a phantom lint error that blocked the workflow verification gate on
    // every task that touched a test file. The tests/** block below overrides rules.
    ignores: ["node_modules/**", "dist/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      local: localPlugin,
    },
    rules: {
      ...stagedSeverity("prod"),
      "local/no-raw-prisma-insensitive": "error",
      "local/no-unscoped-pr-number-lookup": "error",
      "local/no-unguarded-task-delete": "error",
      "local/require-validated-id-param": "error",
    },
  },
  // NOTE(#1349): require-validated-id-param applies everywhere, with no
  // exemptions. It landed with a ratchet list of the files not yet migrated;
  // all 106 mutating sites are done, so the list and its test were removed
  // rather than left empty — an exemption list with nothing in it is a gate
  // that cannot fail. GET is still outside the rule's `methods`; widening it
  // needs the same ratchet built again.
  // Exclude the deletion choke point itself — deleteTaskWithTrash() is the one
  // place allowed to remove a Task row, and every other path must call it.
  {
    files: ["services/task/task-deletion.ts"],
    plugins: { local: localPlugin },
    rules: {
      "local/no-unguarded-task-delete": "off",
    },
  },
  // Exclude getInsensitiveMode() definition itself — it is the correct reference implementation.
  {
    files: ["config/db-provider.ts"],
    plugins: { local: localPlugin },
    rules: {
      "local/no-raw-prisma-insensitive": "off",
    },
  },
  // Exclude findScopedOpenPr() definition itself — it is the canonical scoped
  // prNumber lookup every other module must delegate to.
  {
    files: ["services/github/pr-lookup.ts"],
    plugins: { local: localPlugin },
    rules: {
      "local/no-unscoped-pr-number-lookup": "off",
    },
  },
  {
    files: ["scripts/**/*.ts", "scripts/**/*.cjs"],
    rules: {
      ...stagedSeverity("scripts"),
    },
  },
  // Ambient declaration files (global.d.ts, @types/**) mirror external APIs
  // (bun:test matchers, process-global mocks) whose shapes are outside our
  // control — `any` is the honest type there, so the prod-stage error would
  // only breed noise disables.
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Disable in test files — tests may assert PostgreSQL/SQLite behaviour differences
  // using raw mode literals and must not be flagged as violations.
  {
    files: ["tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    plugins: { local: localPlugin },
    rules: {
      ...stagedSeverity("tests"),
      "local/no-raw-prisma-insensitive": "off",
      "local/no-unscoped-pr-number-lookup": "off",
      // Tests mock the client and assert on `task.delete` being called (or NOT
      // called) — those assertions are how the guard is proven.
      "local/no-unguarded-task-delete": "off",
      "local/require-validated-id-param": "off",
      "local/prefer-test-each-for-similar": "warn",
    },
  },
];
