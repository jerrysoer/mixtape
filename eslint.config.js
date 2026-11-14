import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "artifact/", "data/", "renders/", ".cache/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
);
