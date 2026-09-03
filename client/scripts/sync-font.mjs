/**
 * Copies the Vazirmatn variable font out of node_modules into public/fonts.
 *
 * The upstream filename is `Vazirmatn[wght].woff2`. Square brackets are
 * wildcard syntax to shell globs and need percent-encoding in a URL, and both
 * quietly fail rather than erroring — so the file is renamed on the way in and
 * the app only ever references `vazirmatn.woff2`.
 *
 * Run after upgrading the `vazirmatn` package: `npm run font:sync`
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'vazirmatn', 'fonts', 'webfonts', 'Vazirmatn[wght].woff2');
const targetDir = join(root, 'public', 'fonts');
const target = join(targetDir, 'vazirmatn.woff2');

try {
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`[font] copied Vazirmatn variable font -> public/fonts/vazirmatn.woff2`);
} catch (err) {
  console.error(`[font] failed: ${err.message}`);
  console.error('[font] is the `vazirmatn` package installed? try: npm install');
  process.exitCode = 1;
}
