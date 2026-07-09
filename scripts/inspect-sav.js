#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { inspectSavFile, formatSavDebugReport } = require('../src/biq/savInspect');

function printUsage() {
  console.error('Usage: node scripts/inspect-sav.js <input.sav> [--json] [--limit N] [--biq-out output.biq]');
}

const args = process.argv.slice(2);
if (args.length < 1 || args[0] === '-h' || args[0] === '--help') {
  printUsage();
  process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 2);
}

const inputPath = path.resolve(args[0]);
let json = false;
let limit = 12;
let biqOut = '';
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === '--json') {
    json = true;
  } else if (args[i] === '--limit') {
    i += 1;
    limit = Number.parseInt(args[i], 10);
  } else if (args[i] === '--biq-out') {
    i += 1;
    biqOut = path.resolve(args[i] || '');
  } else {
    printUsage();
    process.exit(2);
  }
}

const report = inspectSavFile(inputPath, { debugBiqBuffer: !!biqOut });
if (!report.ok) {
  console.error(report.error || 'SAV inspect failed.');
  process.exit(1);
}

if (biqOut) {
  fs.mkdirSync(path.dirname(biqOut), { recursive: true });
  fs.writeFileSync(biqOut, report.debugBiqBuffer);
  delete report.debugBiqBuffer;
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatSavDebugReport(report, { limit }));
  if (biqOut) console.log(`\nWrote debug BIQ: ${biqOut}`);
}
