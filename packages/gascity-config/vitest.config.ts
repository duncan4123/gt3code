import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.gc/**",
      "**/.jj/**",
      "**/.jj-workspaces/**",
      "**/.beads.backup-*/**",
      "config/cities/**/rigs/**/packages/**",
    ],
  },
});
