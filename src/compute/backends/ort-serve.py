# Windows-side ONNX Runtime worker (python.exe) for the compute planner. Frame protocol on stdio, same as
# frame.mjs: u32le header length, header JSON, payload buffers named in header["bufs"].
# ONNX Runtime and onnx are pip-installed into ./ort (pip install --target), never system-wide.
# Op 'hello' reports the execution providers actually present, so an NPU (VitisAIExecutionProvider, from the
# AMD Ryzen AI Software build of ONNX Runtime) is detected rather than assumed.
import json, os, struct, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "ort"))
import numpy as np
import onnxruntime as ort
from onnx import helper, TensorProto as T

stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
sessions = {}

def read_exact(n):
    buf = b""
    while len(buf) < n:
        chunk = stdin.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf

def send(header, bufs=()):
    header = dict(header, bufs=[{"name": n, "bytes": len(b)} for n, b in bufs])
    h = json.dumps(header).encode()
    stdout.write(struct.pack("<I", len(h)) + h + b"".join(b for _, b in bufs))
    stdout.flush()

def session(provider, dtype):
    key = (provider, dtype)
    if key not in sessions:
        dt = T.FLOAT16 if dtype == "fp16" else T.FLOAT
        a = helper.make_tensor_value_info("A", dt, [None, None, None])
        r = helper.make_tensor_value_info("r", dt, [None, None, 1])
        g = helper.make_tensor_value_info("g", dt, [None, None, 1])
        graph = helper.make_graph([helper.make_node("MatMul", ["A", "r"], ["g"])], "brier_grad", [a, r], [g])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
        model.ir_version = 9
        sessions[key] = ort.InferenceSession(model.SerializeToString(), providers=[provider])
    return sessions[key]

while True:
    raw = read_exact(4)
    if raw is None:
        break
    (hl,) = struct.unpack("<I", raw)
    h = json.loads(read_exact(hl))
    payload = {}
    for b in h.get("bufs", []):
        payload[b["name"]] = read_exact(b["bytes"])
    try:
        if h["op"] == "hello":
            send({"id": h["id"], "ok": True, "info": {"ort": ort.__version__, "providers": ort.get_available_providers()}})
        elif h["op"] == "k2":
            B, C, K = h["B"], h["C"], h["K"]
            npdt = np.float16 if h["dtype"] == "fp16" else np.float32
            A = np.frombuffer(payload["A"], dtype=np.uint8).reshape(B, C, K).astype(npdt)
            r = np.frombuffer(payload["r"], dtype=np.float64).reshape(B, K, 1).astype(npdt)
            s = session(h["provider"], h["dtype"])
            t = time.perf_counter()
            out = s.run(None, {"A": A, "r": r})[0].astype(np.float32)
            send({"id": h["id"], "ok": True, "ms": (time.perf_counter() - t) * 1e3}, [("out", out.tobytes())])
        else:
            send({"id": h["id"], "ok": False, "error": "unknown op " + h["op"]})
    except Exception as e:  # report, keep serving
        send({"id": h["id"], "ok": False, "error": repr(e)})
