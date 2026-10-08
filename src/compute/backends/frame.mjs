// Length-prefixed binary framing for stdio bridges: u32le headerLength, header JSON, then the payload
// buffers named in header.bufs ([{name, bytes}]) back to back. The Python worker speaks the same frames.
export function encodeFrame(header, buffers = []) {
  const bufs = buffers.map(([name, view]) => ({ name, bytes: view.byteLength }));
  const head = Buffer.from(JSON.stringify({ ...header, bufs }));
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
  return Buffer.concat([len, head, ...buffers.map(([, v]) => Buffer.from(v.buffer, v.byteOffset, v.byteLength))]);
}

/** Incremental decoder: push(chunk) calls onFrame(header, {name: ArrayBuffer}) for each complete frame. */
export function frameReader(onFrame) {
  let acc = Buffer.alloc(0);
  return (chunk) => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    for (;;) {
      if (acc.length < 4) return;
      const hl = acc.readUInt32LE(0); if (acc.length < 4 + hl) return;
      const header = JSON.parse(acc.subarray(4, 4 + hl).toString());
      const total = (header.bufs ?? []).reduce((s, b) => s + b.bytes, 0);
      if (acc.length < 4 + hl + total) return;
      const payload = {}; let o = 4 + hl;
      for (const { name, bytes } of header.bufs ?? []) { payload[name] = acc.buffer.slice(acc.byteOffset + o, acc.byteOffset + o + bytes); o += bytes; }
      acc = acc.subarray(4 + hl + total);
      onFrame(header, payload);
    }
  };
}
