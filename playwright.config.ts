import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:8088',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: process.env.FORKCAST_CHROMIUM_PATH,
      args: ['--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8088 --bind 127.0.0.1 --directory /tmp/forkcast-test-web',
    url: 'http://127.0.0.1:8088',
    reuseExistingServer: false,
  },
});
