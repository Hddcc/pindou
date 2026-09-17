import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const sharp = require('sharp');
const source = fileURLToPath(new URL('../assets/app-logo.jpg', import.meta.url));
const output = new URL('../web/public/icons/', import.meta.url);
await mkdir(output, {recursive: true});

for (const size of [32, 180, 192, 512]) {
  await sharp(source).rotate()
    .resize(size, size, {fit: 'contain', background: '#ffffff'})
    .flatten({background: '#ffffff'}).png()
    .toFile(fileURLToPath(new URL(`laopai-${size}.png`, output)));
}
