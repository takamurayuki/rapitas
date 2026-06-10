import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

// NOTE: Staged rules default to "warn" (dev-friendly). When RAPITAS_LINT_STRICT=1,
// they escalate to "error" so the automated verification gate enforces them as hard
// failures before any merge. Set automatically by automated-verifier; do not set
// manually in .env unless you want permanent strict mode locally.
const stagedSeverity = process.env.RAPITAS_LINT_STRICT === "1" ? "error" : "warn";

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
      "@typescript-eslint/no-explicit-any": stagedSeverity,
      "@typescript-eslint/no-unused-vars": [
        stagedSeverity,
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
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
