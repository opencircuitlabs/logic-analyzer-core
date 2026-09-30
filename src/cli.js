#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { compress, findTrigger, summarizeCapture, toVcd, validateCapture } from './index.js';

const [command = 'analyze', file, ...args] = process.argv.slice(2); const input = () => JSON.parse(readFileSync(file, 'utf8'));
try {
  if (!file) throw new Error('Usage: logic-capture <analyze|validate|trigger|compress|vcd> capture.json [options]');
  if (command === 'validate') { const result = validateCapture(input()); console.log(JSON.stringify(result, null, 2)); if (!result.valid) process.exitCode = 1; }
  else if (command === 'analyze') console.log(JSON.stringify(summarizeCapture(input()), null, 2));
  else if (command === 'compress') { const output = args[0]; const text = JSON.stringify(compress(input()), null, 2) + '\n'; if (output) writeFileSync(output, text); else process.stdout.write(text); }
  else if (command === 'vcd') { const output = args[0]; const text = toVcd(input()); if (output) writeFileSync(output, text); else process.stdout.write(text); }
  else if (command === 'trigger') { const expression = JSON.parse(readFileSync(args[0], 'utf8')); const result = findTrigger(input(), expression); console.log(JSON.stringify(result, null, 2)); if (!result) process.exitCode = 2; }
  else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
