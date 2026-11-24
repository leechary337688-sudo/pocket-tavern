import { readPngCardText, normalizeCard } from '../src/core/card-codec.js';
import { readFile } from 'node:fs/promises';
const buf = await readFile('./dev/exported-card.png');
const png = await readPngCardText(buf);
console.log(png?.keyword, png?.json?.data?.name, normalizeCard(png.json).name, buf.length);
