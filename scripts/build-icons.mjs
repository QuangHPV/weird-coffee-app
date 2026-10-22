// Render the existing vector logo into separate general and adaptive app icons.
// Requires rsvg-convert (librsvg); no raster retouching or generated artwork.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'public/icon.svg'), 'utf8');
const artwork = source.replace(/^<svg[^>]*>/, '').replace(/<rect[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
const ordinary = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -100 1500 1500">${artwork}</svg>\n`;
// All artwork lies within the central 40%-radius safe circle after this padding.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-240 -220 1740 1740"><rect x="-240" y="-220" width="1740" height="1740" fill="#f7f3ed"/>${artwork}</svg>\n`;
for (const [name, svg, sizes] of [['icon-any-v2', ordinary, [192, 512]], ['icon-maskable-v2', maskable, [192, 512]]]) {
  const input = resolve(root, 'public', name + '.svg');
  writeFileSync(input, svg);
  for (const size of sizes) execFileSync('rsvg-convert', ['--width', String(size), '--height', String(size), '--output', resolve(root, 'public', `${name}-${size}.png`), input]);
}
