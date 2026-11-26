import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function sources(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}
test('shared and Android source do not depend on the browser application', () => {
  const violations = [];
  for (const directory of ['app', 'core', 'android/src']) {
    for (const file of sources(path.join(root, directory))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
        if (match[1].startsWith('.') && path.resolve(path.dirname(file), match[1]).startsWith(path.join(root, 'web') + path.sep)) {
          violations.push(`${path.relative(root, file)} → ${match[1]}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});
