import { describe, expect, it } from 'vitest';
import { exportGooToBlob } from './goo-exporter';
import type { CompactGrayLayer } from './png-encode-pool';

describe('exportGooToBlob', () => {
  it('encodes compact layers directly without PNG decoding', async () => {
    const layer: CompactGrayLayer = {
      kind: 'dense-gray',
      values: new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255]),
      filledPixels: 2,
    };

    const blob = await exportGooToBlob(
      { kind: 'compact', layers: [layer] },
      {
        layerHeight: 0.05,
        normalExposure: 2,
        bottomLayers: 6,
        bottomExposure: 30,
        liftHeight: 8,
        liftSpeed: 3,
      },
      {
        name: 'Elegoo Test',
        resolutionX: 8,
        resolutionY: 2,
      },
    );

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('goo!');

    const view = new DataView(bytes.buffer);
    const layerTableOffset = view.getUint32(0x84, true);
    const dataOffset = view.getUint32(layerTableOffset, true);
    const dataSize = view.getUint32(layerTableOffset + 8, true);

    expect(bytes.subarray(dataOffset, dataOffset + dataSize)).toEqual(
      new Uint8Array([1, 1, 1, 128]),
    );
  });
});
