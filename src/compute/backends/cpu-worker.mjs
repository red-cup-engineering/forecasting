import { parentPort } from 'node:worker_threads';
import { KERNELS } from '../kernels.mjs';

parentPort.on('message', ({ kernelId, batch }) => {
  try {
    const result = KERNELS[kernelId].reference(batch);
    parentPort.postMessage({ result }, [result.buffer]);
  } catch (e) { parentPort.postMessage({ error: String(e?.stack ?? e) }); }
});
