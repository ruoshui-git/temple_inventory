import type { StorybookConfig } from "@storybook/vue3-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-mcp",
  ],
  framework: {
    name: "@storybook/vue3-vite",
    options: {
      docgen: {
        plugin: "vue-component-meta",
        tsconfig: "tsconfig.storybook.json",
      },
      builder: {
        viteConfigPath: "storybook.vite.config.ts",
      },
    },
  },
  features: {
    componentsManifest: true,
    experimentalDocgenServer: true,
  },
  staticDirs: ["../public"],
};

export default config;
