import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// A classic, self-contained script also works when dist/index.html is opened from disk.
const result = await build({
  entryPoints: ['src/antd-ui.jsx'],
  bundle: true,
  outfile: 'dist/antd-ui.js',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  metafile: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

// Ship the license notices with the bundled third-party code.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = path.dirname(path.resolve(input));
  while (directory !== path.dirname(directory)) {
    try {
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (pkg.name) packages.set(`${pkg.name}@${pkg.version}`, directory);
      break;
    } catch { directory = path.dirname(directory); }
  }
}
const notices = ['Third-party software included in antd-ui.js\n'];
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(directory)).filter(name => /^(license|licence|notice)(\.|$)/i.test(name));
  for (const file of files) notices.push(`\n--- ${name} / ${file} ---\n${await readFile(path.join(directory, file), 'utf8')}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
