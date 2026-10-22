import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = import.meta.dirname;
const defaultOut = resolve(root, 'docs');
let out = defaultOut;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Keep the preceding release's entry files available for clients migrating from
// the original update checker, which fingerprints its old entry script remotely.
let previous = [], legacy = [];
try {
  const gitFile = name => execFileSync('git', ['show', `HEAD:docs/${name}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  let names;
  try { const deployed = JSON.parse(gitFile('release.json')); names = deployed.assets.map(asset => asset.url); legacy = deployed.legacyAssets || []; }
  catch { names = execFileSync('git', ['ls-tree', '--name-only', 'HEAD:docs/assets'], { cwd: root, encoding: 'utf8' }).trim().split('\n').map(name => 'assets/' + name); legacy = names; }
  previous = [...new Set([...names, ...legacy])].filter(name => name.startsWith('assets/')).map(name => [name, gitFile(name)]);
} catch {
  if (existsSync(resolve(out, 'assets'))) previous = readdirSync(resolve(out, 'assets'))
    .filter(name => /\.(js|css)$/.test(name)).map(name => [`assets/${name}`, readFileSync(resolve(out, 'assets', name))]);
}
export default defineConfig({ plugins: [{
  name: 'complete-pwa-release',
  configResolved(config) { out = resolve(config.root, config.build.outDir); if (out !== defaultOut) { previous = []; legacy = []; } },
  closeBundle() {
    const files = [];
    function walk(dir, prefix = '') {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) walk(resolve(dir, entry.name), name + '/');
        else if (!['sw.js', 'release.json'].includes(name)) files.push(name);
      }
    }
    walk(out);
    const worker = readFileSync(resolve(out, 'sw.js'), 'utf8');
    const id = digest(worker + JSON.stringify(legacy) + files.sort().map(name => name + digest(readFileSync(resolve(out, name)))).join('')).slice(0, 20);
    const htmlPath = resolve(out, 'index.html');
    writeFileSync(htmlPath, readFileSync(htmlPath, 'utf8').replace('<head>', `<head>\n  <meta name="app-release" content="${id}">`));
    const release = { id, legacyAssets: legacy, assets: files.map(url => ({ url, sha256: digest(readFileSync(resolve(out, url))) })) };
    writeFileSync(resolve(out, 'release.json'), JSON.stringify(release));
    writeFileSync(resolve(out, 'sw.js'), worker.replace('/*BUILD_RELEASE*/ null', JSON.stringify(release)));
    for (const [name, bytes] of previous) {
      const path = resolve(out, name);
      if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
    }
  }
}] });
