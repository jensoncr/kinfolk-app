import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "react/display-name": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".claude/**",
      ".agents/**",
      "out/**",
      "public/**",
      "design-explorations/**",
      "supabase/.temp/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
