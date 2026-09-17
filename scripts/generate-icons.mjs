import sharp from 'sharp';
import { mkdirSync } from 'fs';

const SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512];
mkdirSync('public/icons', { recursive: true });

for (const size of SIZES) {
  await sharp('public/icon.svg', { density: 300 })
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`generated public/icons/icon-${size}.png`);
}
console.log('done');
