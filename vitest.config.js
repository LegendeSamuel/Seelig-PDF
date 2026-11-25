import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  cacheDir: path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'seelig-pdf-vitest-cache'),
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node'
  }
});
