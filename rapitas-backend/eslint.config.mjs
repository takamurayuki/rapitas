import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { stagedSeverity } from "../eslint-shared.mjs";
import noRawPrismaInsensitive from "./eslint-rules/no-raw-prisma-insensitive.mjs";

/** @type {import('eslint').Linter.Plugin} */
const localPlugin = {
  rules: {
    "no-raw-prisma-insensitive": noRawPrismaInsensitive,
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
    files: ["scripts/**/*.ts"],
    rules: {
      ...stagedSeverity("scripts"),
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
    },
  },
];
