import { defineConfig, globalIgnores } from "eslint/config";
import hooks from "eslint-plugin-react-hooks";
import ts from "typescript-eslint";

export default defineConfig([
  globalIgnores(["android/**", "ios/**", "dist/**", ".expo/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [ts.configs.recommended],
    plugins: { "react-hooks": hooks },
    rules: {
      "@typescript-eslint/no-require-imports": [
        "error",
        { allow: ["\\.png$"] },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
]);
