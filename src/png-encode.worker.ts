/**
 * PNG encode worker.
 * Receives an RGBA buffer (bottom-up from gl.readPixels), flips it and reduces
 * to a single grayscale channel (R), then encodes as PNG. Returns the PNG bytes
 * via transferable so there is no copy on the way back.
 *
 * The flip + grayscale fold matches what the main thread used to do in
 * exporter.ts so output bytes are identical.
 */
import { encode as encodePng } from 'fast-png';

interface EncodeRequest {
  id: number;
  rgba: Uint8Array;
  width: number;
  height: number;
}

interface EncodeResponse {
  id: number;
  png: Uint8Array;
}

function flipAndGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      gray[dstRow + x] = rgba[srcRow + x * 4];
    }
  }
  return gray;
}

self.onmessage = (e: MessageEvent<EncodeRequest>): void => {
  const { id, rgba, width, height } = e.data;
  const gray = flipAndGray(rgba, width, height);
  const png = encodePng({ data: gray, width, height, channels: 1 });
  const response: EncodeResponse = { id, png };
  (self as unknown as Worker).postMessage(response, [png.buffer]);
};
