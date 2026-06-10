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
      // Forbid direct `mode: 'insensitive'` literals in Prisma filter objects.
      // The desktop (SQLite) Prisma client omits `mode` from StringFilter, so a
      // literal here causes PrismaClientValidationError at runtime. All callers
      // must go through insensitiveContains() / insensitiveEquals() in
      // utils/database/db-helpers.ts, which guards on the active DB provider.
      "no-restricted-syntax": [
        "error",
        {
          // Plain form:  { mode: 'insensitive' }
          selector: "Property[key.name='mode'][value.type='Literal'][value.value='insensitive']",
          message:
            "mode: 'insensitive' の直書き禁止。utils/database/db-helpers の insensitiveContains() / insensitiveEquals() を使うこと。",
        },
        {
          // `as const` form:  { mode: 'insensitive' as const }
          selector:
            "Property[key.name='mode'][value.type='TSAsExpression'][value.expression.value='insensitive']",
          message:
            "mode: 'insensitive' の直書き禁止。utils/database/db-helpers の insensitiveContains() / insensitiveEquals() を使うこと。",
        },
      ],
    },
  },
  {
    // NOTE: db-helpers.ts is the sole legitimate location for `mode: 'insensitive'`
    // literals — it is the implementation of the helpers that every other file
    // must use. Exclude it from the no-restricted-syntax rule so the rule can be
    // applied globally without false positives in the one place where the literal
    // is intentional.
    files: ["utils/database/db-helpers.ts"],
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
      // Tests may construct expected values containing { mode: 'insensitive' }
      // as fixtures or assertions; allow it here.
      "no-restricted-syntax": "off",
    },
  },
];
