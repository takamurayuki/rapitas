import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

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
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // NOTE: `mode: 'insensitive'` is Postgres-only. Use caseInsensitive() from utils/database instead.
      "no-restricted-syntax": [
        "error",
        {
          "selector": "Property[key.name='mode'] > Literal[value='insensitive']",
          "message": "`mode: 'insensitive'` の直書き禁止。`caseInsensitive()`（utils/database）を使うこと。"
        }
      ],
    },
  },
  {
    // NOTE: prisma-helpers.ts is the authorised source and its test file must
    // assert the literal value — both are exempt from the restriction.
    files: [
      "utils/database/prisma-helpers.ts",
      "tests/utils/prisma-helpers.test.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "warn",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
