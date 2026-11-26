// @vitest-environment node
// WASM_BASE in signEngine.js must load the same @mediapipe/tasks-vision version that package.json pins,
// otherwise the JS bundle and the WASM runtime disagree and HandLandmarker fails at runtime.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WASM_BASE } from './signEngine';

it('WASM_BASE version equals the exact pin in package.json', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  const pinned = pkg.dependencies['@mediapipe/tasks-vision'];
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);                     // exact, no ^ or ~
  expect(WASM_BASE).toContain(`tasks-vision@${pinned}/`);
});
