# Logic Analyzer Core

A dependency-free digital-capture engine for logic analyzers, protocol decoders, browser instruments, and automated hardware tests.

It provides a validated 32-channel packed-sample model, transition extraction, lossless run-length compression, capture slicing, transition-aware downsampling, composable triggers, frequency/duty measurements, VCD export, and CLI workflows.

## Quick start

```bash
npm install
npm test
node src/cli.js validate examples/uart-capture.json
node src/cli.js analyze examples/uart-capture.json
node src/cli.js trigger examples/uart-capture.json examples/rising-trigger.json
node src/cli.js vcd examples/uart-capture.json capture.vcd
```

## Capture model

```json
{
  "schemaVersion": 1,
  "sampleRateHz": 1000000,
  "channels": [{ "name": "clk" }, { "name": "data" }],
  "samples": [0, 1, 3, 2, 0],
  "triggerSample": 2
}
```

Each sample is an unsigned packed state: bit zero is channel zero. The validator rejects duplicate or unsafe names, out-of-range states, invalid sampling rates, captures wider than 32 channels, and trigger positions outside the capture.

## Triggers

Triggers are declarative expression trees:

```js
const expression = {
  op: 'and',
  conditions: [
    { op: 'edge', channel: 'data', edge: 'rising' },
    { op: 'level', channel: 'enable', value: 1 }
  ]
};
```

Supported operations are `level`, `edge` (`rising`, `falling`, or `either`), multi-channel `pattern`, `and`, `or`, and `not`. `findTrigger` returns exact sample, time, and packed state, or `null` if the condition never occurs.

## Capture processing

- `transitions` converts one channel into timestamped state changes.
- `compress` and `decompress` use a portable, lossless RLE format with count verification and expansion limits.
- `sliceCapture` rebases time and trigger location safely.
- `downsample` preserves capture bounds and transition neighborhoods for responsive rendering.
- `measureChannel` returns duty cycle, edge counts, average frequency, and period range.
- `toVcd` creates sparse IEEE-style value-change data for waveform tools.

All processing functions validate inputs and return new objects rather than mutating the capture. The core intentionally does not access USB or serial hardware; acquisition adapters can produce the same versioned model in browsers, Node.js, or native bridges.

## License

MIT
