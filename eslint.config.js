import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-demo/**", "**/node_modules/**", "**/.data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // The server reaches the internet only through fetch, which lib/net.ts guards with its list of
    // destinations (docs/privacy.md). Other ways out would go around that list.
    files: ["server/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "http",
            "https",
            "net",
            "tls",
            "dgram",
            "http2",
            "undici",
            "axios",
            "got",
            "node-fetch",
            "ws",
          ].flatMap((name) =>
            [name, `node:${name}`].map((n) => ({
              name: n,
              message: "Use fetch: it only reaches the destinations in server/src/lib/net.ts.",
            })),
          ),
        },
      ],
    },
  },
  {
    // Node scripts; screenshots.js also runs functions inside the page (puppeteer's evaluate).
    files: ["scripts/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["web/**/*.{ts,tsx,js}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // The code allows `any` (API responses in tests, parsed exports), so these would only repeat that.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Fastify handlers are async by convention, with or without an await inside.
      "@typescript-eslint/require-await": "off",
      // React event handlers may be async; a forgotten promise anywhere else is still an error.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
  },
  // Plain JavaScript files (this config, web/public/theme.js) aren't part of a TypeScript project.
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
