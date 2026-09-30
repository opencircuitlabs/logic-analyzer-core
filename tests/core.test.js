import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compress, decompress, downsample, findTrigger, measureChannel, normalizeCapture, sliceCapture, summarizeCapture, toVcd, transitions, validateCapture } from '../src/index.js';

const capture = JSON.parse(readFileSync(new URL('../examples/uart-capture.json', import.meta.url), 'utf8'));

test('example capture validates', () => assert.deepEqual(validateCapture(capture), { valid: true, issues: [] }));
test('normalization annotates stable channel indices without mutating input', () => {
  const result = normalizeCapture(capture); assert.equal(result.channels[2].index, 2); assert.equal(capture.channels[2].index, undefined);
});
test('transitions carry exact sample and time', () => {
  const result = transitions(capture, 'data'); assert.deepEqual(result.slice(0, 3), [{ sample: 0, timeSeconds: 0, value: 0 }, { sample: 8, timeSeconds: 0.000008, value: 1 }]);
});
test('RLE compression round trips losslessly', () => {
  const encoded = compress(capture); assert.equal(encoded.runs.length, 8); assert.deepEqual(decompress(encoded).samples, capture.samples);
});
test('compressed sample mismatch and expansion bomb are rejected', () => {
  const encoded = compress(capture); encoded.sampleCount++; assert.throws(() => decompress(encoded), /mismatch/);
  assert.throws(() => decompress({ ...encoded, sampleCount: undefined, runs: [{ state: 0, length: 100000001 }] }), /Refusing/);
});
test('slice rebases start and trigger positions', () => {
  const result = sliceCapture(capture, 6, 12); assert.equal(result.startTimeSeconds, 0.000006); assert.equal(result.triggerSample, 2); assert.equal(result.samples.length, 6);
});
test('downsampling preserves bounds and transition neighborhoods', () => {
  const result = downsample(capture, 6); assert.equal(result.samples.length, 6); assert.equal(result.sampleIndices[0], 0); assert.equal(result.sampleIndices.at(-1), 15);
});
test('compound trigger locates an edge under a level condition', () => {
  const trigger = { op: 'and', conditions: [{ op: 'edge', channel: 'data', edge: 'rising' }, { op: 'level', channel: 'enable', value: 1 }] };
  assert.equal(findTrigger(capture, trigger).sample, 8);
});
test('pattern and negation triggers are supported', () => {
  assert.equal(findTrigger(capture, { op: 'pattern', channels: { clk: 1, data: 0, enable: 1 } }).sample, 2);
  assert.equal(findTrigger(capture, { op: 'not', condition: { op: 'level', channel: 'enable', value: 0 } }).sample, 0);
});
test('measurements report duty cycle, edges, and frequency', () => {
  const result = measureChannel(capture, 'clk'); assert.equal(result.dutyCycle, 0.5); assert.equal(result.risingEdges, 4); assert.equal(result.averageFrequencyHz, 250000);
});
test('VCD export declares channels and emits sparse timestamps', () => {
  const output = toVcd(capture); assert.match(output, /\$timescale 1ns \$end/); assert.match(output, /\$var wire 1 ! clk \$end/); assert.match(output, /#2000/);
});
test('summary includes all per-channel measurements and compression ratio', () => {
  const result = summarizeCapture(capture); assert.equal(result.channelCount, 3); assert.equal(result.channels.length, 3); assert.equal(result.compression, 0.5);
});
test('invalid states, duplicate channels, and triggers are rejected', () => {
  const bad = structuredClone(capture); bad.channels[1].name = 'clk'; bad.samples[0] = 8; bad.triggerSample = 99;
  const result = validateCapture(bad); assert.equal(result.valid, false); assert.ok(result.issues.length >= 3);
  assert.throws(() => findTrigger(capture, { op: 'edge', channel: 'missing', edge: 'rising' }), /Unknown channel/);
});
