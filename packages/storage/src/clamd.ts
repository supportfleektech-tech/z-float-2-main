/**
 * Minimal clamd client: scans a file's BYTES with the INSTREAM command.
 *
 * Protocol (clamd(8)): send `zINSTREAM\0`, then the payload as chunks, each
 * prefixed by its length as a 4-byte big-endian unsigned int, terminated by
 * a zero-length chunk. clamd answers with one NUL-terminated line:
 *   "stream: OK"                        → clean
 *   "stream: <Signature> FOUND"         → infected
 *   "INSTREAM size limit exceeded. ERROR" / "... ERROR" → error
 *
 * Anything unexpected (connection refused, timeout, unparseable reply) is
 * reported as ERROR — callers must treat ERROR as "not clean" (fail closed).
 */
import { createConnection } from "node:net";

export type ClamdVerdict = "CLEAN" | "INFECTED" | "ERROR";

export interface ClamdScanResult {
  verdict: ClamdVerdict;
  /** Raw clamd reply (or a local error description) for audit/logging. */
  detail: string;
}

export interface ClamdOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  /** Chunk size for INSTREAM; must stay below clamd's StreamMaxLength. */
  chunkSize?: number;
}

/** Parse a clamd INSTREAM reply line into a verdict. */
export function parseClamdReply(reply: string): ClamdVerdict {
  const line = reply.replace(/\0/g, "").trim();
  if (/\bFOUND$/.test(line)) return "INFECTED";
  if (/^stream: OK$/.test(line)) return "CLEAN";
  return "ERROR";
}

/** Encode a payload as INSTREAM frames (command + length-prefixed chunks + terminator). */
export function encodeInstream(body: Buffer, chunkSize = 64 * 1024): Buffer {
  const parts: Buffer[] = [Buffer.from("zINSTREAM\0", "latin1")];
  for (let off = 0; off < body.length; off += chunkSize) {
    const chunk = body.subarray(off, Math.min(off + chunkSize, body.length));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunk.length, 0);
    parts.push(len, chunk);
  }
  parts.push(Buffer.alloc(4)); // zero-length terminator
  return Buffer.concat(parts);
}

export function clamdScan(body: Buffer, opts: ClamdOptions = {}): Promise<ClamdScanResult> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 3310;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    let settled = false;
    let reply = "";
    const done = (r: ClamdScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => done({ verdict: "ERROR", detail: `clamd timeout after ${timeoutMs}ms` }), timeoutMs);
    socket.on("connect", () => socket.write(encodeInstream(body, opts.chunkSize)));
    socket.on("data", (d: Buffer) => {
      reply += d.toString("latin1");
      if (reply.includes("\0")) done({ verdict: parseClamdReply(reply), detail: reply.replace(/\0/g, "").trim() });
    });
    socket.on("end", () => done({ verdict: parseClamdReply(reply), detail: reply.replace(/\0/g, "").trim() || "clamd closed without reply" }));
    socket.on("error", (err) => done({ verdict: "ERROR", detail: `clamd connection error: ${err.message}` }));
  });
}
