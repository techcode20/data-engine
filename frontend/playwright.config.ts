import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  use: {
    baseURL: "http://localhost:5199",
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --port 5199 --strictPort",
    url: "http://localhost:5199/",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
