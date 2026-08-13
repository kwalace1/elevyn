"""Vercel neural speech endpoint.

Uses Microsoft's Edge neural voice through edge-tts. This keeps Elevyn's
natural Sonia voice when the rest of the brain runs as Vercel Functions.
"""

import asyncio
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler

import edge_tts


VOICE = os.environ.get("ELEVYN_TTS_VOICE", "en-GB-SoniaNeural")
RATE = os.environ.get("ELEVYN_TTS_RATE", "-2%")
PITCH = os.environ.get("ELEVYN_TTS_PITCH", "+1Hz")


async def synthesize(text: str, output: str) -> None:
    communicate = edge_tts.Communicate(
        text=text,
        voice=VOICE,
        rate=RATE,
        pitch=PITCH,
        volume="+0%",
    )
    await communicate.save(output)


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            size = min(int(self.headers.get("content-length", "0")), 8192)
            payload = json.loads(self.rfile.read(size) or b"{}")
            text = " ".join(str(payload.get("text", "")).split())[:400]

            if not text:
                self.send_error(400, "text required")
                return

            with tempfile.NamedTemporaryFile(suffix=".mp3") as output:
                asyncio.run(synthesize(text, output.name))
                output.seek(0)
                audio = output.read()

            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("X-Elevyn-Voice", VOICE)
            self.send_header("X-Elevyn-Cached", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:
            body = json.dumps({"error": f"Speech synthesis failed: {error}"}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()
