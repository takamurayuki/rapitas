import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { stagedSeverity } from "../eslint-shared.mjs";
import noRawPrismaInsensitive from "./eslint-rules/no-raw-prisma-insensitive.mjs";
import preferTestEachForSimilar from "./eslint-rules/prefer-test-each-for-similar.mjs";

/** @type {import('eslint').Linter.Plugin} */
const localPlugin = {
  rules: {
    "no-raw-prisma-insensitive": noRawPrismaInsensitive,
    "prefer-test-each-for-similar": preferTestEachForSimilar,
  },
};

export default [
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
      "local/prefer-test-each-for-similar": "warn",
    },
  },
];
