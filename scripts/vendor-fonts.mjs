import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

mkdirSync('public/fonts', { recursive: true });

const css = execSync(`curl -s -m 30 "${CSS_URL}" -A "${UA}"`).toString();
const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com[^)]+/g) || [])];
console.log(`found ${urls.length} font files`);

let out = css;
for (const url of urls) {
  const hash = createHash('md5').update(url).digest('hex').slice(0, 10);
  const ext = url.endsWith('.woff2') ? 'woff2' : 'woff';
  const name = `${hash}.${ext}`;
  execSync(`curl -s -m 60 "${url}" -o "public/fonts/${name}"`);
  out = out.split(url).join(`/fonts/${name}`);
  console.log(`downloaded ${name}`);
}

writeFileSync('src/fonts.css', out);
console.log('wrote src/fonts.css (self-hosted)');
