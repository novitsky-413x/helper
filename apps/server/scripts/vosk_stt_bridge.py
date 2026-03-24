"""
Vosk STT bridge: length-prefixed PCM (mono int16 LE, 16 kHz) on stdin, JSON events on stdout.
Install: pip install vosk
Usage: python vosk_stt_bridge.py <MODEL_DIR>
"""
from __future__ import annotations

import json
import struct
import sys

try:
    import vosk  # type: ignore
except ImportError:
    print(json.dumps({"type": "error", "message": "pip install vosk"}), flush=True)
    sys.exit(1)


def read_chunk() -> bytes | None:
    len_bytes = sys.stdin.buffer.read(4)
    if not len_bytes or len(len_bytes) < 4:
        return None
    (n,) = struct.unpack("<I", len_bytes)
    if n == 0:
        return b""
    data = sys.stdin.buffer.read(n)
    if len(data) != n:
        return None
    return data


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "model path required"}), flush=True)
        sys.exit(1)

    model_path = sys.argv[1]
    vosk.SetLogLevel(-1)
    model = vosk.Model(model_path)
    rec = vosk.KaldiRecognizer(model, 16000)
    last_partial = ""

    def emit_final_from_result(raw: str) -> None:
        nonlocal last_partial
        try:
            res = json.loads(raw)
        except json.JSONDecodeError:
            return
        t = (res.get("text") or "").strip()
        if t:
            print(json.dumps({"type": "final", "text": t}), flush=True)
        last_partial = ""

    while True:
        chunk = read_chunk()
        if chunk is None:
            break
        if len(chunk) == 0:
            emit_final_from_result(rec.FinalResult())
            rec = vosk.KaldiRecognizer(model, 16000)
            continue

        if rec.AcceptWaveform(chunk):
            emit_final_from_result(rec.Result())
        else:
            try:
                pr = json.loads(rec.PartialResult())
            except json.JSONDecodeError:
                continue
            pt = (pr.get("partial") or "").strip()
            if pt != last_partial:
                last_partial = pt
                print(json.dumps({"type": "partial", "text": pt}), flush=True)

    emit_final_from_result(rec.FinalResult())


if __name__ == "__main__":
    main()
