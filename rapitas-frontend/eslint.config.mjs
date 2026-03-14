import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ignore scripts directory
    "scripts/**",
    // Ignore Tauri build directory
    ".next-tauri/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Enforce explicit typing over `any`
      "@typescript-eslint/no-explicit-any": "warn",
      // Prefer consistent type-only imports
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Catch unused variables (allow underscore prefix)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
