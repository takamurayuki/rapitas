#!/usr/bin/env node
/**
 * SVGをPNGに変換するスクリプト
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.resolve(__dirname, '../src-tauri/icons');
const SVG_PATH = path.join(ICONS_DIR, 'app-icon.svg');
const PNG_PATH = path.join(ICONS_DIR, 'icon.png');

console.log('Converting SVG to PNG...');

const svg = fs.readFileSync(SVG_PATH, 'utf8');

const resvg = new Resvg(svg, {
  fitTo: {
    mode: 'width',
    value: 1024
  }
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();

fs.writeFileSync(PNG_PATH, pngBuffer);

console.log(`Created: ${PNG_PATH}`);
console.log(`Size: ${pngBuffer.length} bytes`);
console.log('\nNow run: cd src-tauri && cargo tauri icon icons/icon.png');
