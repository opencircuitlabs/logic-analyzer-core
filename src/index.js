const CHANNEL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const bit = (state, index) => (state >>> index) & 1;
const stateLimit = (count) => count === 32 ? 0x1_0000_0000 : 2 ** count;

export function validateCapture(capture) {
  const issues = []; const fail = (path, message) => issues.push({ path, message });
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return { valid: false, issues: [{ path: '$', message: 'must be an object' }] };
  if (capture.schemaVersion !== 1) fail('schemaVersion', 'must equal 1');
  if (!Number.isFinite(capture.sampleRateHz) || capture.sampleRateHz <= 0) fail('sampleRateHz', 'must be positive');
  if (!Array.isArray(capture.channels) || !capture.channels.length || capture.channels.length > 32) fail('channels', 'must contain 1 to 32 channels');
  const names = new Set();
  for (const [i, channel] of (capture.channels ?? []).entries()) {
    if (!CHANNEL.test(channel.name ?? '')) fail(`channels.${i}.name`, 'must be an identifier');
    if (names.has(channel.name)) fail(`channels.${i}.name`, 'is duplicated'); names.add(channel.name);
  }
  if (!Array.isArray(capture.samples)) fail('samples', 'must be an array');
  const limit = stateLimit(capture.channels?.length ?? 1);
  for (const [i, state] of (capture.samples ?? []).entries()) if (!Number.isSafeInteger(state) || state < 0 || state >= limit) fail(`samples.${i}`, `must be an unsigned ${capture.channels?.length ?? 0}-bit state`);
  if (capture.triggerSample != null && (!Number.isInteger(capture.triggerSample) || capture.triggerSample < 0 || capture.triggerSample >= (capture.samples?.length ?? 0))) fail('triggerSample', 'must reference a sample');
  return { valid: issues.length === 0, issues };
}

export function normalizeCapture(input) {
  const result = validateCapture(input); if (!result.valid) throw new Error(result.issues.map((x) => `${x.path}: ${x.message}`).join('; '));
  return { ...structuredClone(input), channels: input.channels.map((channel, index) => ({ color: null, ...channel, index })), samples: input.samples.map((x) => x >>> 0), startTimeSeconds: input.startTimeSeconds ?? 0 };
}

export function channelIndex(capture, name) {
  const index = capture.channels.findIndex((channel) => channel.name === name);
  if (index < 0) throw new Error(`Unknown channel: ${name}`); return index;
}

export function transitions(input, channelName) {
  const capture = normalizeCapture(input); const index = channelIndex(capture, channelName); const result = [];
  if (!capture.samples.length) return result;
  let previous = bit(capture.samples[0], index); result.push({ sample: 0, timeSeconds: capture.startTimeSeconds, value: previous });
  for (let sample = 1; sample < capture.samples.length; sample++) { const value = bit(capture.samples[sample], index); if (value !== previous) { result.push({ sample, timeSeconds: capture.startTimeSeconds + sample / capture.sampleRateHz, value }); previous = value; } }
  return result;
}

export function compress(input) {
  const capture = normalizeCapture(input); const runs = [];
  for (let start = 0; start < capture.samples.length;) { const state = capture.samples[start]; let end = start + 1; while (end < capture.samples.length && capture.samples[end] === state) end++; runs.push({ state, length: end - start }); start = end; }
  return { schemaVersion: 1, encoding: 'rle-state-v1', sampleRateHz: capture.sampleRateHz, channels: capture.channels.map(({ index, ...channel }) => channel), startTimeSeconds: capture.startTimeSeconds, triggerSample: capture.triggerSample, sampleCount: capture.samples.length, runs };
}

export function decompress(data) {
  if (data?.encoding !== 'rle-state-v1' || !Array.isArray(data.runs)) throw new Error('Unsupported compressed capture');
  const samples = [];
  for (const [i, run] of data.runs.entries()) { if (!Number.isInteger(run.length) || run.length < 1) throw new Error(`runs.${i}.length must be positive`); if (samples.length + run.length > 100_000_000) throw new Error('Refusing to expand more than 100,000,000 samples'); for (let n = 0; n < run.length; n++) samples.push(run.state); }
  if (data.sampleCount != null && samples.length !== data.sampleCount) throw new Error('Compressed sample count mismatch');
  return normalizeCapture({ schemaVersion: 1, sampleRateHz: data.sampleRateHz, channels: data.channels, samples, startTimeSeconds: data.startTimeSeconds, triggerSample: data.triggerSample });
}

export function sliceCapture(input, startSample = 0, endSample) {
  const capture = normalizeCapture(input); startSample = Math.max(0, Math.trunc(startSample)); endSample = Math.min(capture.samples.length, endSample == null ? capture.samples.length : Math.trunc(endSample));
  if (endSample < startSample) throw new Error('endSample must not precede startSample');
  return { ...capture, samples: capture.samples.slice(startSample, endSample), startTimeSeconds: capture.startTimeSeconds + startSample / capture.sampleRateHz, triggerSample: capture.triggerSample == null || capture.triggerSample < startSample || capture.triggerSample >= endSample ? undefined : capture.triggerSample - startSample };
}

export function downsample(input, maxSamples) {
  const capture = normalizeCapture(input); if (!Number.isInteger(maxSamples) || maxSamples < 2) throw new Error('maxSamples must be at least 2');
  if (capture.samples.length <= maxSamples) return capture;
  const selected = new Set([0, capture.samples.length - 1]); const transitions = [];
  for (let i = 1; i < capture.samples.length; i++) if (capture.samples[i] !== capture.samples[i - 1]) transitions.push(i - 1, i);
  if (transitions.length <= maxSamples - 2) for (const i of transitions) selected.add(i);
  else for (let i = 0; i < maxSamples - 2; i++) selected.add(transitions[Math.floor(i * transitions.length / (maxSamples - 2))]);
  const indices = [...selected].sort((a, b) => a - b).slice(0, maxSamples);
  return { ...capture, samples: indices.map((i) => capture.samples[i]), sampleIndices: indices, originalSampleRateHz: capture.sampleRateHz };
}

export function compileTrigger(input, expression) {
  const capture = normalizeCapture(input);
  const compile = (node) => {
    if (!node || typeof node !== 'object') throw new Error('Trigger expression must be an object');
    if (node.op === 'level') { const i = channelIndex(capture, node.channel); if (![0, 1].includes(node.value)) throw new Error('level value must be 0 or 1'); return (at) => bit(capture.samples[at], i) === node.value; }
    if (node.op === 'edge') { const i = channelIndex(capture, node.channel); if (!['rising', 'falling', 'either'].includes(node.edge)) throw new Error('edge must be rising, falling, or either'); return (at) => at > 0 && (node.edge === 'either' ? bit(capture.samples[at - 1], i) !== bit(capture.samples[at], i) : node.edge === 'rising' ? !bit(capture.samples[at - 1], i) && bit(capture.samples[at], i) : bit(capture.samples[at - 1], i) && !bit(capture.samples[at], i)); }
    if (node.op === 'and' || node.op === 'or') { if (!Array.isArray(node.conditions) || !node.conditions.length) throw new Error(`${node.op} requires conditions`); const children = node.conditions.map(compile); return node.op === 'and' ? (at) => children.every((fn) => fn(at)) : (at) => children.some((fn) => fn(at)); }
    if (node.op === 'not') { const child = compile(node.condition); return (at) => !child(at); }
    if (node.op === 'pattern') { const masks = Object.entries(node.channels ?? {}).map(([name, value]) => [channelIndex(capture, name), value]); if (!masks.length || masks.some(([, value]) => ![0, 1].includes(value))) throw new Error('pattern needs channel values of 0 or 1'); return (at) => masks.every(([i, value]) => bit(capture.samples[at], i) === value); }
    throw new Error(`Unsupported trigger operation: ${node.op}`);
  };
  return compile(expression);
}

export function findTrigger(input, expression, options = {}) {
  const capture = normalizeCapture(input); const predicate = compileTrigger(capture, expression); const start = Math.max(0, options.startSample ?? 0); const end = Math.min(capture.samples.length, options.endSample ?? capture.samples.length);
  for (let sample = start; sample < end; sample++) if (predicate(sample)) return { sample, timeSeconds: capture.startTimeSeconds + sample / capture.sampleRateHz, state: capture.samples[sample] };
  return null;
}

export function measureChannel(input, channelName) {
  const capture = normalizeCapture(input); const edges = transitions(capture, channelName); const duration = capture.samples.length / capture.sampleRateHz; let highSamples = 0; const index = channelIndex(capture, channelName);
  for (const state of capture.samples) highSamples += bit(state, index);
  const rising = edges.filter((edge, i) => edge.value === 1 && (edge.sample > 0 || i > 0)); const periods = rising.slice(1).map((edge, i) => edge.timeSeconds - rising[i].timeSeconds);
  const avgPeriod = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : null;
  return { channel: channelName, durationSeconds: duration, highSeconds: highSamples / capture.sampleRateHz, dutyCycle: capture.samples.length ? highSamples / capture.samples.length : null, risingEdges: rising.length, fallingEdges: edges.filter((edge) => edge.value === 0 && edge.sample > 0).length, averageFrequencyHz: avgPeriod ? 1 / avgPeriod : null, minimumPeriodSeconds: periods.length ? Math.min(...periods) : null, maximumPeriodSeconds: periods.length ? Math.max(...periods) : null };
}

const vcdId = (index) => { let value = index; let id = ''; do { id = String.fromCharCode(33 + value % 94) + id; value = Math.floor(value / 94) - 1; } while (value >= 0); return id; };
export function toVcd(input, options = {}) {
  const capture = normalizeCapture(input); const timescaleNs = options.timescaleNs ?? 1; if (!Number.isFinite(timescaleNs) || timescaleNs <= 0) throw new Error('timescaleNs must be positive');
  const step = 1e9 / capture.sampleRateHz / timescaleNs; const lines = ['$version OpenCircuitLabs logic-analyzer-core $end', `$timescale ${timescaleNs}ns $end`, '$scope module logic $end'];
  capture.channels.forEach((channel, i) => lines.push(`$var wire 1 ${vcdId(i)} ${channel.name} $end`)); lines.push('$upscope $end', '$enddefinitions $end');
  if (!capture.samples.length) return lines.join('\n') + '\n';
  lines.push('#0'); capture.channels.forEach((_, i) => lines.push(`${bit(capture.samples[0], i)}${vcdId(i)}`));
  let previous = capture.samples[0]; for (let sample = 1; sample < capture.samples.length; sample++) if (capture.samples[sample] !== previous) { lines.push(`#${Math.round(sample * step)}`); capture.channels.forEach((_, i) => { if (bit(previous, i) !== bit(capture.samples[sample], i)) lines.push(`${bit(capture.samples[sample], i)}${vcdId(i)}`); }); previous = capture.samples[sample]; }
  return lines.join('\n') + '\n';
}

export function summarizeCapture(input) {
  const capture = normalizeCapture(input); return { sampleRateHz: capture.sampleRateHz, sampleCount: capture.samples.length, durationSeconds: capture.samples.length / capture.sampleRateHz, channelCount: capture.channels.length, transitionCount: capture.samples.reduce((count, state, i) => count + (i > 0 && state !== capture.samples[i - 1] ? 1 : 0), 0), compression: compress(capture).runs.length / Math.max(1, capture.samples.length), channels: capture.channels.map((channel) => measureChannel(capture, channel.name)) };
}
