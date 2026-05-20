# Slice Pixel Storage Optimization Plan

## Goal

Reduce slice-time memory use and export latency by avoiding storage of implicit
black pixels. The slicer should treat pixels that are not explicitly present in a
layer payload as black, while preserving existing exported PNG, CTB, GOO, SL1,
and CWS behavior.

This plan builds on the current sparse grayscale cache path:

- `src/png-encode-pool.ts` can create a sparse grayscale layer from RGBA pixels.
- `src/png-encode.worker.ts` can reconstruct missing pixels as black before PNG
  encoding.
- `src/features/gpu-slicing/ops.ts` queues sparse grayscale payloads for
  slice-time PNG caching.

## Non-Goals

- Do not change printer output semantics.
- Do not remove the on-demand full RGBA render path until all consumers can use
  compact layer payloads.
- Do not rewrite proprietary exporters in the first pass.
- Do not persist compact layers into project files unless there is a separate
  project format migration plan.

## Current Data Flow

1. `Slicer.slice()` renders a full RGBA layer.
2. `executeSlice()` scans the RGBA layer for white-pixel counts.
3. `executeSlice()` converts the RGBA layer to sparse grayscale and queues it in
   `PngEncodePool`.
4. `png-encode.worker.ts` expands sparse grayscale to a dense grayscale image
   because `fast-png` expects dense image data.
5. Exporters use either cached PNG bytes or on-demand rendered pixel buffers.

The main remaining waste is duplicate scanning and the lack of adaptive compact
formats for dense or structured layers.

## Target Representation

Introduce an explicit compact layer union that can be passed through worker and
export paths:

```ts
type CompactLayer =
  | EmptyLayer
  | SparseGrayLayer
  | DenseGrayLayer
  | BitsetLayer
  | RleGrayLayer;
```

Suggested initial interfaces:

```ts
interface EmptyLayer {
  kind: 'empty';
  width: number;
  height: number;
}

interface SparseGrayLayer {
  kind: 'sparse-gray';
  width: number;
  height: number;
  indices: Uint32Array;
  values: Uint8Array;
  filledPixels: number;
}

interface DenseGrayLayer {
  kind: 'dense-gray';
  width: number;
  height: number;
  values: Uint8Array;
  filledPixels: number;
}

interface BitsetLayer {
  kind: 'bitset';
  width: number;
  height: number;
  bits: Uint8Array;
  filledPixels: number;
}

interface RleGrayLayer {
  kind: 'rle-gray';
  width: number;
  height: number;
  runs: Uint32Array;
  values: Uint8Array;
  filledPixels: number;
}
```

Keep width and height on each payload so workers and exporters do not need to
trust parallel arguments that can drift from the layer itself.

## Phase 1: Adaptive Sparse vs Dense Grayscale

### Objective

Choose the smaller grayscale payload per layer:

- Empty marker when all pixels are black.
- Sparse grayscale when lit pixels are rare.
- Dense grayscale when the layer is mostly filled.

### Implementation Steps

1. Rename `makeSparseGrayLayer()` to a more general builder, for example
   `makeCompactGrayLayer()`.
2. During the RGBA scan, compute:
   - `filledPixels`
   - `nonBlackPixels`
   - optional `hasPartialGray`, if antialiasing or paint texture creates values
     other than `0` or `255`
3. Estimate payload sizes:
   - empty: near zero
   - sparse: `nonBlackPixels * 5`
   - dense grayscale: `width * height`
4. Return the smallest lossless payload.
5. Update `PngEncodePool.encode()` overloads to accept the compact layer union.
6. Update `png-encode.worker.ts` to handle `empty`, `sparse-gray`, and
   `dense-gray`.
7. In `executeSlice()`, use `compact.filledPixels` for volume and peel-force
   counts instead of calling `countWhitePixels()` separately.

### Acceptance Criteria

- Empty layers do not allocate index or value arrays.
- Mostly black layers still use sparse payloads.
- Mostly filled layers use dense grayscale and do not pay the 5 bytes per lit
  pixel sparse cost.
- Existing PNG output remains visually identical.
- Existing volume totals remain unchanged.

### Tests

- `makeCompactGrayLayer()` returns `empty` for all-black RGBA.
- It returns `sparse-gray` for a small number of non-black pixels.
- It returns `dense-gray` when sparse would be larger.
- It reports `filledPixels` using the same threshold as `countWhitePixels()`.
- `executeSlice()` no longer calls or depends on a second white-pixel scan for
  volume counts.
- PNG worker encodes equivalent PNGs from sparse and dense inputs.

## Phase 2: Empty Layer Reuse

### Objective

Avoid repeated worker jobs for empty layers.

### Implementation Steps

1. Add an empty PNG cache keyed by `width x height`.
2. When `executeSlice()` receives an `empty` layer, assign the cached empty PNG
   promise instead of dispatching a unique worker job.
3. If the empty PNG is not cached yet, dispatch one worker job and reuse the
   promise for subsequent empty layers.
4. Make the cache local to the shared PNG pool or a small helper module, not a
   global in `executeSlice()`.

### Acceptance Criteria

- A print with 100 empty layers encodes one empty PNG, not 100.
- Progress reporting still advances per layer.
- Exported ZIP still contains one PNG file per layer, even if bytes are reused.

### Tests

- Multiple empty layers call `pool.encode()` only once for a given resolution.
- Mixed empty and non-empty layers preserve layer order.
- Different resolutions do not share the same empty PNG bytes.

## Phase 3: Bitset Payload for Binary Layers

### Objective

Use one bit per pixel when the layer is strictly binary. This reduces memory for
large filled regions compared with sparse indices and dense grayscale.

### Implementation Steps

1. Extend the compact layer builder to detect binary-only layers:
   - every red-channel value is either `0` or `255`
2. Estimate bitset size:
   - `Math.ceil(width * height / 8)`
3. Compare bitset against sparse and dense grayscale.
4. Add worker expansion from bitset to dense grayscale for PNG encoding.
5. Keep dense grayscale as the fallback when partial gray values exist.
6. Add helper functions:
   - `setBit(bits, pixelIndex)`
   - `getBit(bits, pixelIndex)`
   - `countSetBits(bits)`, if useful for validation

### Acceptance Criteria

- Binary layers can use bitset payloads.
- Partial-gray layers never use bitset.
- CTB/GOO-style binary exporters can eventually consume bitsets directly.

### Tests

- Binary layer chooses bitset when smaller than sparse and dense.
- Antialiased or texture-painted grayscale layer does not choose bitset.
- Worker expansion of bitset matches dense grayscale output.
- `filledPixels` equals the number of set bits.

## Phase 4: Row RLE Payload

### Objective

Compress structured slice layers with long horizontal spans. Resin slices often
contain contiguous solid cross-sections where row RLE can be smaller than
sparse, bitset, or dense grayscale.

### Proposed Encoding

Use row-major runs:

```ts
interface RleGrayLayer {
  kind: 'rle-gray';
  width: number;
  height: number;
  runs: Uint32Array;
  values: Uint8Array;
  filledPixels: number;
}
```

Pack each run into one `Uint32`:

- high bits: start pixel index
- low bits: run length

If this cannot safely represent the largest supported printer resolution, use
two arrays instead:

- `starts: Uint32Array`
- `lengths: Uint32Array`
- `values: Uint8Array`

The simpler two-array form is larger but safer and easier to debug.

### Implementation Steps

1. Add an RLE candidate pass while scanning each row.
2. Estimate RLE byte size before allocating final arrays if possible.
3. Compare RLE size against sparse, dense, empty, and bitset candidates.
4. Add worker expansion from RLE to dense grayscale.
5. Keep RLE row-local. Do not let runs cross row boundaries; this simplifies
   debugging and future direct exporter use.

### Acceptance Criteria

- Long horizontal filled spans choose RLE.
- Sparse isolated pixels still choose sparse.
- Fully filled binary layers choose bitset or RLE based on actual size.
- PNG output remains identical after vertical flip.

### Tests

- One full-width row chooses RLE when it is smaller than alternatives.
- Checkerboard data does not choose RLE if it would be larger.
- RLE expansion preserves row boundaries.
- RLE `filledPixels` excludes black runs.

## Phase 5: Exporter Integration

### Objective

Let slice exporters consume compact layer payloads directly where useful, instead
of forcing every path through dense RGBA or PNG.

### Implementation Steps

1. Extend `LayerSource` in `src/core/format-registry.ts`:

   ```ts
   type LayerSource =
     | { kind: 'pixels'; layers: Uint8Array[] }
     | { kind: 'compact'; layers: CompactLayer[] }
     | { kind: 'png'; pngs: Uint8Array[] };
   ```

2. Update `encodePixelLayersToPngs()` into a more general helper:
   - `encodeLayersToPngs(source, width, height, onProgress)`
3. Keep `pixels` support for compatibility.
4. Teach PNG-based exporters to use compact payloads.
5. Later, teach CTB and GOO exporters to encode directly from binary compact
   payloads:
   - `empty`: emit one black run
   - `bitset`: scan bits
   - `rle-gray`: convert runs to format-specific runs
   - `sparse-gray`: either scan sparse index order or expand when direct
     conversion is not worth the complexity

### Acceptance Criteria

- Existing export formats still work from cached PNG bytes.
- Export fallback works from compact layers when PNG cache is unavailable.
- CTB and GOO exporters no longer require full RGBA for binary layers after
  their direct paths are implemented.

### Tests

- ZIP/CWS/SL1 PNG exports match previous dimensions and layer count.
- CTB/GOO binary encoders produce the same on/off sequence from RGBA and bitset.
- Export progress reports do not regress.

## Phase 6: Measurement and Guardrails

### Objective

Make the optimization observable and prevent memory regressions.

### Implementation Steps

1. Add optional debug counters:
   - layer count by compact kind
   - bytes queued by compact kind
   - skipped cache reason
   - empty PNG cache hits
2. Expose counters only in development logs or test helpers.
3. Add a micro-benchmark or fixture test that builds representative layers:
   - all black
   - sparse islands
   - solid rectangle
   - mostly filled
   - checkerboard
   - antialiased gradient edge
4. Record expected payload kind and approximate byte size for each fixture.

### Acceptance Criteria

- We can explain which compact representation was selected for a layer.
- Fixture tests prevent choosing a larger payload when a smaller lossless option
  is obvious.
- Cache abandonment remains bounded by byte thresholds, not raw resolution alone.

## Rollout Order

1. Adaptive empty/sparse/dense and `filledPixels` reuse.
2. Empty PNG reuse.
3. Bitset for binary layers.
4. RLE for row spans.
5. Exporter compact-source support.
6. Direct CTB/GOO compact encoders.
7. Measurement and fixture coverage after each phase.

This order keeps the first changes low risk and useful immediately, then moves
toward format-specific export wins once compact layer behavior is proven.

## Risk Notes

- Threshold mismatch can change volume estimates. All compact builders must use
  the same filled-pixel threshold as `countWhitePixels()`.
- Sparse and RLE payloads must preserve the existing vertical flip behavior when
  encoding PNGs.
- Transferable buffers are detached after worker dispatch. Do not read compact
  typed arrays after calling `postMessage()` with their buffers.
- Dense grayscale is smaller than sparse once more than about 20 percent of
  pixels are non-black. Bitset can beat both for binary layers.
- Antialiasing or procedural paint texture can create non-binary grayscale
  values. Bitset paths must not silently discard those values.

## Definition of Done

- Slice-time cache stores no explicit black pixels except when dense grayscale is
  selected because it is the smallest lossless payload.
- Empty layers are represented without per-pixel payloads.
- White-pixel counts are derived from the compact builder scan.
- Focused unit tests cover representation selection and worker reconstruction.
- Typecheck passes.
- Exported layer images remain visually identical for representative fixtures.
