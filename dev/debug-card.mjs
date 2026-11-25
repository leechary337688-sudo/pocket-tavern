import { readPngCardText, normalizeCard } from '../src/core/card-codec.js';
import { readFile } from 'node:fs/promises';
const buf = await readFile('./dev/fixtures/test-ccv2.png');
const png = await readPngCardText(buf);
console.log(png?.keyword, png?.text?.slice(0, 120));
console.log(png?.json && Object.keys(png.json), png?.json?.data?.name);
if (png) console.log(normalizeCard(png.json, { avatar: '' }).name);

