#!/usr/bin/env python3
"""Africa's Talking-compatible SMS gateway mock (demo).

Accepts the same request shape AT uses:
  POST /v1/messages
  Authorization: Bearer <apiKey>
  {"to": ["+2547..."], "from": "Z-FLOAT", "message": "..."}

Logs every accepted message to /tmp/sms-gateway.log as JSON lines and replies
with an AT-style success envelope. Exists so the real SMS_DRIVER=http code
path is exercised end-to-end in the sandbox without an AT account.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = "/tmp/sms-gateway.log"
COUNT = [0]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except Exception:
            self._reply(400, {"error": "invalid json"})
            return

        api_key = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        COUNT[0] += 1
        with open(LOG, "a") as f:
            f.write(
                json.dumps(
                    {
                        "n": COUNT[0],
                        "at": time.time(),
                        "path": self.path,
                        "api_key": api_key,
                        "payload": payload,
                    }
                )
                + "\n"
            )

        recipients = payload.get("to", [])
        if not recipients:
            self._reply(400, {"error": "missing to"})
            return
        self._reply(
            200,
            {
                "SMSMessageData": {
                    "Message": "Sent to 1/1 Total Cost: KES 0.80",
                    "Recipients": [{"statusCode": 101, "number": r, "cost": "KES 0.80"} for r in recipients],
                }
            },
        )

    def do_GET(self):
        if self.path.startswith("/health"):
            self._reply(200, {"ok": True, "received": COUNT[0]})
            return
        self._reply(404, {"error": "not found"})


if __name__ == "__main__":
    port = 9090
    print(f"[sms-gateway-mock] listening on 0.0.0.0:{port}, log={LOG}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
