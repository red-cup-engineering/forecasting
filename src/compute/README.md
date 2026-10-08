# compute: measured placement of prediction-market math

Run the same typed kernel on the CPU pool, a GPU, or (when reachable) an NPU. `planner.place()` chooses per
call from calibrated measurements (startup, fixed cost, per-work cost, error against the float64 reference)
and the CPU load right now. Nothing is assumed: an unavailable or too-imprecise backend is skipped with its reason.

```js
import { createPlanner } from './planner.mjs';
import { KERNELS } from './kernels.mjs';
const planner = createPlanner();               // cache: $COMPUTE_CALIBRATION or ~/.cache/561-group/compute-calibration.json
await planner.calibrate();                     // sequential; skips fresh cache entries (24 h; failures retried after 15 min)
const batch = KERNELS['mvn-orthant'].make(20000);
const { result, decision } = await planner.run('mvn-orthant', batch, { tolerance: 1e-5 });
console.log(decision.backend, decision.reason);  // e.g. "webgpu-windows fastest within tolerance 1e-5: ~275 ms vs webgpu-wsl ~3455 ms"
```

## Kernels (`kernels.mjs`)

| id | what | reference |
| --- | --- | --- |
| `mvn-orthant` (K1) | batched P(X <= b), X ~ N(0,R), Genz SOV Monte Carlo, dimension 2-9, 4000 samples | `mvnLowerProb` (`combo-pricer.mjs`) |
| `brier-grad` (K2) | batched dense gradient `A r` of the Brier projection's Frank-Wolfe step (cells x markets) | the `grad` loop of `brierProjection` (`combo-rigidity.mjs`) |

Batches are packed typed arrays so every backend receives the same bytes. The GPU K1 reproduces the reference's
mulberry32 stream exactly (the generator is counter-based, so draw k is random-access), so GPU and CPU differ only by
fp32 rounding, not by Monte Carlo noise. Cholesky, shrink and early exits stay on the host in float64 (`prepareMvn`).

## Backends and how each is reached

| id | route | precision | kernels |
| --- | --- | --- | --- |
| `cpu-inline` | single thread, the reference itself | fp64 | all |
| `cpu-pool` | `worker_threads`, sized to cores and to MemAvailable/45 MB per worker | fp64 | all |
| `webgpu-wsl` | in-process Dawn (npm `webgpu`) under WSL: **Vulkan llvmpipe, i.e. CPU**, not the GPU (no Mesa dozen driver; /dev/dxg unused) | fp32 | all |
| `webgpu-windows` | `node.exe` over WSL interop, Windows build of the same npm package: Dawn -> D3D12 -> Radeon 860M | fp32 | all |
| `ort-dml-fp32/fp16` | `python.exe` + ONNX Runtime DirectML EP (Radeon), pip `--target` | fp32 / fp16 | K2 only (no inverse-CDF op in ONNX) |
| `ort-npu-fp16` | same worker with `VitisAIExecutionProvider` (XDNA 2). Unavailable until Ryzen AI Software's ORT is installed | fp16 | K2 only |

**Opt-in only:** the Windows backends run only with `COMPUTE_WINDOWS_INTEROP=1`.
- Each interop launch allocates a Hyper-V socket ring, an order-7 contiguous kernel block.
- Under load the WSL VM runs out of these blocks and interop wedges. On 2026-10-08 the VM died this way (`vmbus_alloc_ring` page allocation failures).
- Turn them back on only behind a long-lived Windows-side worker started once per host.

Windows-side files live in `%TEMP%\bcf-compute` (override `COMPUTE_WINDOWS_DIR`, a WSL path). Provision once, no admin:

1. `wgpu/node_modules/webgpu`: copy `package.json`, `index.js`, `build/` and `dist/win32-x64/` of the npm `webgpu` package.
2. `ort/`: `python -m pip install --target %TEMP%\bcf-compute\ort onnxruntime-directml onnx` (run via `cmd.exe /c ... > log`).
3. WSL side: `npm i webgpu` in any scratch dir; point `COMPUTE_WEBGPU_DIR` at it (for `webgpu-wsl`).

The bridges (`backends/bridge.mjs`) run the `.exe` inside `cat | exe | cat`: interop cannot hand a Windows binary a
Unix-socket stdio, and fails intermittently under load ("UtilAcceptVsock accept4 failed 110"). A bridge that has not
answered in 20 s is relaunched (4 launches); every call has a deadline; a dead backend is struck off and the next
best (finally `cpu-inline`) runs. Dawn gotcha: keep the `create()` instance referenced (`openGpu` does) or mapAsync crashes natively.

## Measured (Bare Cedar Fog, Ryzen AI 7 350, machine loaded by other jobs: load average 5-8)

K1, items/s (ms per call), error vs float64 reference:

| backend | 64 | 512 | 4096 | error |
| --- | --- | --- | --- | --- |
| cpu-inline | 153 (418) | 158 (3238) | - | 0 |
| cpu-pool (14 workers) | 761 (84) | 901 (568) | 745 (5497) | 0 |
| webgpu-wsl (llvmpipe) | 4944 (13) | 5584 (92) | 7118 (576) | 1e-7 |
| webgpu-windows (Radeon, D3D12) | 9022 (7) | 42746 (12) | 59718 (69) | 1e-7 |

K2 (cells 64 x markets 24), families/s (ms per call):

| backend | 64 | 1024 | 16384 | error |
| --- | --- | --- | --- | --- |
| cpu-inline | 51668 (1.2) | 79202 (12.9) | 69196 (237) | 0 |
| cpu-pool | 13911 (4.6) | 124511 (8.2) | 304157 (54) | 0 |
| webgpu-wsl (llvmpipe) | 28222 (2.3) | 64238 (16) | 62533 (262) | 7e-7 |
| webgpu-windows | 13616 (4.7) | 28110 (36) | 7377 (2221) | 7e-7 |
| ort-dml-fp32 | 19455 (3.3) | 48290 (21) | 23376 (701) | 7e-7 |
| ort-dml-fp16 | 12780 (5.0) | 22899 (45) | 22178 (739) | 2e-3..4e-3 |
| ort-npu-fp16 | unavailable: VitisAIExecutionProvider absent | | | |

K1 is compute-bound (hundreds of exp/log per sample): the Radeon wins by orders of magnitude. K2 is a memory-bound
mat-vec: the host-to-device copy costs more than the multiply, so the CPU pool wins from ~1000 families up, and a
single thread below. The planner reaches these conclusions from the calibration, not from this table. K2 only pays on a
device when the iterate stays resident across Frank-Wolfe iterations (not built).

End to end, 20,000 parlays (K1, 4000 samples): single thread 128.4 s; planner -> webgpu-windows 0.40 s
(**x318**, max abs error 2.7e-7); cpu-pool alone 19.1 s (x6.7).

## Adding a kernel or backend

- Kernel: add `{id, reference, make(n, {seed}), size, work, slice, concat, error}` to `kernels.mjs` and register it in `KERNELS`; add calibration sizes and a default tolerance in `planner.mjs`; the reference must be pure and the batch typed arrays.
- Backend: return `{id, device, precision, kernels:Set, probe() -> {ok, reason?, info}, run(kernelId, batch) -> Float64Array, close()}` from a new file in `backends/`, add it to `defaultBackends()` in `planner.mjs`, and it is tested by `test/compute-backends.test.mjs` automatically (skipped, with reason, when its probe fails).

## NPU

Not reachable here: the NPU enumerates in Windows ("NPU Compute Accelerator Device") but this host has no Ryzen AI Software;
its ONNX Runtime (`onnxruntime-directml` 1.24.4) lists only `DmlExecutionProvider` and `CPUExecutionProvider`. To reach it:
install AMD Ryzen AI Software (its installer provides the Windows NPU driver check, a conda env with the AMD-built
`onnxruntime` that carries `VitisAIExecutionProvider`, and the XDNA runtime), then point the worker at that env's
`python.exe` (`createWindowsOrt({id: 'ort-npu-fp16', provider: 'VitisAIExecutionProvider', python: ...})`) and supply a
quantized/BF16 model with VitisAI provider options (`config_file`, cache dir). The XDNA 2 NPU takes int8/bf16 CNN/transformer-style graphs, so K2 would need to be
expressed as a quantized MatMul; K1 cannot be.
