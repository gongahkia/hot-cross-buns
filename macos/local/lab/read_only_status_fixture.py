#!/usr/bin/env python3
"""Disposable pipe-level Go bridge fixture. No desktop input or inference."""
import collections
import ctypes
import hashlib
import http.server
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import threading
import time

class Usage(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in
        ["user", "system", "idle_wakes", "interrupt_wakes", "pageins", "wired", "rss", "footprint", "start", "exit"]]
lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
lib.proc_pid_rusage.restype = ctypes.c_int

class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]
timebase = Timebase()
assert ctypes.CDLL("/usr/lib/libSystem.B.dylib").mach_timebase_info(ctypes.byref(timebase)) == 0

def sample(pid):
    info = Usage()
    if lib.proc_pid_rusage(pid, 0, ctypes.byref(info)):
        raise OSError(ctypes.get_errno(), "owned-process resource sample failed")
    return {"wall": time.monotonic(), "cpu_ns": (info.user + info.system) * timebase.numer // timebase.denom, "rss": info.rss, "footprint": info.footprint}

def phase(a, b):
    seconds = b["wall"] - a["wall"]
    return {"seconds": seconds, "cpu_one_core_percent": (b["cpu_ns"] - a["cpu_ns"]) / 1e9 / seconds * 100,
            "rss_mib": b["rss"] / 2**20, "physical_footprint_mib": b["footprint"] / 2**20}

runtime, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
# Validate CPU-counter units against this sampler's own process CPU clock.
a, cpu_a = sample(os.getpid()), time.process_time()
while time.process_time() - cpu_a < 0.1:
    pass
b, cpu_b = sample(os.getpid()), time.process_time()
ratio = (b["cpu_ns"] - a["cpu_ns"]) / 1e9 / (cpu_b - cpu_a)
assert 0.85 < ratio < 1.15, "CPU counter units could not be verified"
events = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        events.append({"method": "GET", "path": self.path})
        payload = {"version": "read-only-fixture"} if self.path == "/api/version" else {"models": []}
        if self.path == "/api/tags":
            payload = {"models": [{"name": "qwen3:4b", "size": 2500000000, "digest": "sha256:inert-fixture"}]}
        self.send_response(200 if self.path in ["/api/version", "/api/tags", "/api/ps"] else 404)
        self.end_headers(); self.wfile.write(json.dumps(payload).encode())
    def do_POST(self):
        events.append({"method": "POST", "path": self.path}); self.send_error(405)
    def do_DELETE(self):
        events.append({"method": "DELETE", "path": self.path}); self.send_error(405)

with tempfile.TemporaryDirectory(prefix="hot-cross-buns-l2a-readonly-") as temporary:
    root = Path(temporary)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    config = root / "config/hot-cross-buns/config.json"; config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"version": 4, "defaults": {"provider": "openai", "model": "fixture"},
        "custom_providers": [{"id":"hot-cross-buns-local", "base_url":f"http://127.0.0.1:{server.server_port}/v1/chat/completions", "models":["qwen3:4b"], "default_model":"qwen3:4b"}]}))
    config.chmod(0o600)
    before = hashlib.sha256(config.read_bytes()).hexdigest()
    workspace = root / "workspace"; workspace.mkdir()
    environment = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(root),
        "HOT_CROSS_BUNS_CONFIG_DIR": str(root/"config"), "HOT_CROSS_BUNS_STATE_DIR": str(root/"state"),
        "HOT_CROSS_BUNS_UI_BACKEND":"1", "HOT_CROSS_BUNS_UI_SESSION_HOST":"1", "GIT_CONFIG_NOSYSTEM":"1", "GIT_CONFIG_GLOBAL":"/dev/null"}
    stderr = tempfile.TemporaryFile()
    process = subprocess.Popen([str(runtime), "ui-backend", "", ""], cwd=workspace, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, bufsize=0)
    selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b""; frames = collections.deque()
    def read_until(predicate, timeout=15):
        global buffer
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            while frames:
                frame = json.loads(frames.popleft())
                if predicate(frame): return frame
            if not selector.select(max(0, deadline-time.monotonic())): break
            data = os.read(process.stdout.fileno(), 65536)
            if not data: raise RuntimeError("owned bridge exited before exact result")
            buffer += data
            assert len(buffer) < 4*1024*1024, "fixture frame limit"
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n",1)
                if line: frames.append(line)
        raise TimeoutError("exact fixture result not observed")
    def send(frame):
        process.stdin.write((json.dumps({"version":1, **frame})+"\n").encode()); process.stdin.flush()
    try:
        ready = read_until(lambda f:f.get("type")=="state")
        samples = [sample(process.pid)]
        time.sleep(1); samples.append(sample(process.pid)); idle = phase(samples[-2],samples[-1])
        latencies = []; request_ids=[]; result_ids=[]
        begin = sample(process.pid)
        final = None
        for index in range(20):
            rid=f"inspection-{index}"; request_ids.append(rid); start=time.monotonic()
            send({"type":"native_provider", "nonce":f"ack-{index}", "native_provider":{"request_id":rid,"action":"local_status"}})
            final=read_until(lambda f:f.get("type")=="state" and f["state"].get("native_provider_result",{}).get("request_id")==rid)
            result=final["state"]["native_provider_result"]
            assert not result.get("error") and not result.get("changed") and not result.get("confirmed")
            status=result["local"]; result_ids.append(status["result_id"])
            assert status["reachable"] and status["installed_known"] and status["loaded_known"]
            assert status["installed"][0]["loaded"] is False and status["selected_provider"]=="openai"
            latencies.append((time.monotonic()-start)*1000); samples.append(sample(process.pid))
        active=phase(begin,samples[-1])
        settled_start=sample(process.pid); time.sleep(2); samples.append(sample(process.pid)); settled=phase(settled_start,samples[-1])
        assert len(events)==60 and all(e["method"]=="GET" for e in events)
        assert len(set(result_ids))==20
        after=hashlib.sha256(config.read_bytes()).hexdigest(); assert before==after
        send({"type":"exit"}); process.stdin.close(); process.wait(timeout=5)
        assert process.returncode==0
        stderr.seek(0); diagnostics=stderr.read(65537); assert len(diagnostics)<=65536
        (output/"go-stderr.txt").write_bytes(diagnostics)
        (output/"final-public-result.json").write_text(json.dumps(final["state"]["native_provider_result"],indent=2))
        report={"runtime_sha256":hashlib.sha256(runtime.read_bytes()).hexdigest(),"controller_pid":os.getpid(),"go_pid":process.pid,"cpu_counter_unit_ratio":ratio,"mach_timebase_numer":timebase.numer,"mach_timebase_denom":timebase.denom,
            "kind":"pipe-level Go fixture; not native desktop acceptance", "idle":idle,"refresh_burst":active,"settled":settled,"refresh_latency_ms":latencies,
            "samples":samples,"events":events,"request_ids":request_ids,"result_ids":result_ids,"config_sha256_before":before,"config_sha256_after":after,"normal_go_exit":True,
            "external_model_calls":0,"model_mutations":0,"note":"CPU samples cover the Go process, excluding short sysctl children and the Python fake server/controller."}
        (output/"bridge-resource-results.json").write_text(json.dumps(report,indent=2))
        print(json.dumps({"idle":idle,"refresh_burst":active,"settled":settled,"get_requests":len(events),"normal_go_exit":True},indent=2))
    finally:
        if process.poll() is None:
            process.terminate(); process.wait(timeout=5)
        selector.close(); server.shutdown(); server.server_close(); stderr.close()
