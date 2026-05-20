interface CountRequest {
  id: number;
  rgba: Uint8Array;
}

interface CountResponse {
  id: number;
  count: number;
}

self.onmessage = (e: MessageEvent<CountRequest>): void => {
  const { id, rgba } = e.data;
  let count = 0;
  if (rgba.byteOffset % 4 === 0 && rgba.byteLength % 4 === 0) {
    const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4);
    for (let i = 0; i < u32.length; i++) {
      if ((u32[i] & 0xff) > 128) count++;
    }
  } else {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] > 128) count++;
    }
  }
  const response: CountResponse = { id, count };
  (self as unknown as Worker).postMessage(response);
};
