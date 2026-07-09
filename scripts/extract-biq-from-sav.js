#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractEmbeddedBiqFromSavFile } = require('../src/biq/savExtract');

function printUsage() {
  console.error('Usage: node scripts/extract-biq-from-sav.js <input.sav> [output.biq]');
  console.error('If output.biq is omitted, writes ./<input-basename>.embedded.biq in the current directory.');
}

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args[0] === '-h' || args[0] === '--help') {
  printUsage();
  process.exit(args.length === 0 || args[0] === '-h' || args[0] === '--help' ? 0 : 2);
}

const inputPath = path.resolve(args[0]);
const defaultName = `${path.basename(inputPath, path.extname(inputPath))}.embedded.biq`;
const outputPath = path.resolve(args[1] || defaultName);

const result = extractEmbeddedBiqFromSavFile(inputPath);
if (!result.ok) {
  console.error(result.error || 'Failed to extract embedded BIQ from SAV.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, result.buffer);

const meta = result.metadata || {};
console.log(`Wrote ${outputPath}`);
console.log(`BIQ bytes: ${result.buffer.length}`);
console.log(`SAV version: ${meta.savMajorVersion}.${meta.savMinorVersion}`);
console.log(`BIQ tag: ${meta.biqVersionTag}`);
if (meta.searchPath) console.log(`Search path: ${meta.searchPath}`);
if (meta.saveFileName) console.log(`Save file name: ${meta.saveFileName}`);
