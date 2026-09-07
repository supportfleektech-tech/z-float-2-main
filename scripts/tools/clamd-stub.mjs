#!/usr/bin/env node
/**
 * ClamAV-compatible scan daemon for the SANDBOX demo/E2E stack ONLY.
 *
 * The platform's malware pipeline (services/worker, MALWARE_SCANNER_DRIVER=
 * clamav) speaks the clamd TCP protocol, but the sandbox has no real ClamAV
 * daemon and the worker's client streams no file bytes (it presents a storage
 * key), so even a real clamd could not serve it. This double listens on
 * 127.0.0.1:3310, resolves the key to the local storage file
 * (STORAGE_LOCAL_DIR), actually reads the bytes and performs real content
 * heuristics: the EICAR test signature and script/executable markers are
 * reported FOUND (infected); everything else scans OK. It is sandbox
 * infrastructure — exactly like scripts/tools/minio and the [email:console]
 * driver — NOT a component of the platform and never a claim of real
 * antivirus protection (see docs/KNOWN_LIMITATIONS.md).
 *
 * Usage: node scripts/tools/clamd-stub.mjs   (env: STORAGE_LOCAL_DIR)
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const HOST = process.env.CLAMAV_HOST ?? "127.0.0.1";
const ROOT = process.env.STORAGE_LOCAL_DIR ?? "/home/user/zfloat/data/storage";

// Heuristics evaluated against the actual stored bytes (case-insensitive).
const INFECTED_MARKERS = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-", // EICAR test signature
  "eicar",
];
const DANGEROUS_EXT = [".php", ".sh", ".exe", ".bat", ".cmd"];

function scan(key) {
  const safe = path.normalize(String(key)).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.join(ROOT, safe);
  if (!abs.startsWith(path.resolve(ROOT))) return { error: true };
  if (!fs.existsSync(abs)) return { error: true };
  const buf = fs.readFileSync(abs);
  const lower = buf.toString("latin1").toLowerCase();
  for (const m of INFECTED_MARKERS) {
    if (lower.includes(m)) return { infected: path.basename(abs) };
  }
  const ext = path.extname(abs).toLowerCase();
  if (DANGEROUS_EXT.includes(ext)) return { infected: path.basename(abs) };
  return { ok: true };
}

const server = net.createServer((socket) => {
  let buf = "";
  socket.setEncoding("latin1");
  socket.on("data", (chunk) => {
    buf += chunk;
    let nul = buf.indexOf("\0");
    if (nul === -1) return;
    const cmdLine = buf.slice(0, nul);
    buf = buf.slice(nul + 1);
    const parts = cmdLine.split(/\s+/).filter(Boolean);
    const cmd = parts[0]?.toUpperCase() ?? "";
    if (cmd === "PING") {
      socket.end("PONG\0");
      return;
    }
    if (cmd === "VERSION") {
      socket.end("ClamAV 0.103.0 (sandbox stub)\0");
      return;
    }
    if (cmd.startsWith("ZINSTREAM") || cmd === "INSTREAM") {
      // clamd protocol: the payload follows the command's NUL — the worker
      // presents its storage key there ("zINSTREAM\0<storageKey>\0").
      let key = parts.slice(1).join(" ");
      if (!key && buf.length > 0) {
        const end = buf.indexOf("\0");
        key = (end === -1 ? buf : buf.slice(0, end)).trim();
        buf = "";
      }
      let r;
      try {
        r = scan(key);
      } catch {
        r = { error: true };
      }
      if (r.error) socket.end("stream: ERROR\0");
      else if (r.infected) socket.end(`stream: ${r.infected}.UNOFFICIAL FOUND\0`);
      else socket.end("stream: OK\0");
      return;
    }
    socket.end("ERROR\0");
  });
  socket.on("error", () => {});
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[clamd-stub] sandbox scan daemon on ${HOST}:${PORT} (storage root ${ROOT})`);
});
