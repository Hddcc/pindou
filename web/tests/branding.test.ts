import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {describe, expect, it} from 'vitest';

describe('photo application icons', () => {
  const source = fileURLToPath(new URL('../../assets/app-logo.jpg', import.meta.url));

  it.each([32, 180, 192, 512])('uses the complete source photo at %i pixels', async size => {
    const icon = fileURLToPath(new URL(`../public/icons/laopai-${size}.png`, import.meta.url));
    const metadata = await sharp(icon).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
    const expected = await sharp(source).rotate()
      .resize(size, size, {fit: 'contain', background: '#ffffff'})
      .flatten({background: '#ffffff'}).raw().toBuffer();
    expect(await sharp(icon).raw().toBuffer()).toEqual(expected);
  });
});
