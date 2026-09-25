/**
 * clamd INSTREAM client — exercised against a fake clamd that speaks the real
 * framing (zINSTREAM\0, 4-byte BE length-prefixed chunks, zero terminator)
 * and flags the EICAR test signature. Proves the file BYTES reach the
 * scanner (not the storage key) and that every failure mode fails closed.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type AddressInfo } from "node:net";
import { clamdScan, parseClamdReply, encodeInstream } from "../src/clamd";

// Standard antivirus test string (harmless by design).
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

/** Fake clamd: decodes INSTREAM frames and records what it received. */
function fakeClamd(opts: { silent?: boolean } = {}): Promise<{ port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const cmd = Buffer.from("zINSTREAM\0", "latin1");
      if (buf.length < cmd.length || !buf.subarray(0, cmd.length).equals(cmd)) return;
      let off = cmd.length;
      const chunks: Buffer[] = [];
      while (off + 4 <= buf.length) {
        const len = buf.readUInt32BE(off);
        if (len === 0) {
          const body = Buffer.concat(chunks);
          received.push(body);
          if (opts.silent) return;
          sock.end(body.includes(Buffer.from(EICAR)) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (off + 4 + len > buf.length) return; // wait for more
        chunks.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
    });
  });
  return new Promise((resolve) =>
    server!.listen(0, "127.0.0.1", () => resolve({ port: (server!.address() as AddressInfo).port, received })),
  );
}

describe("clamd INSTREAM client", () => {
  it("streams the file bytes and reports CLEAN", async () => {
    const { port, received } = await fakeClamd();
    const body = Buffer.from("%PDF-1.7 harmless KYC certificate");
    const r = await clamdScan(body, { port });
    expect(r.verdict).toBe("CLEAN");
    expect(received[0]!.equals(body)).toBe(true);
  });

  it("detects the EICAR signature split across many small chunks", async () => {
    const { port, received } = await fakeClamd();
    const body = Buffer.concat([Buffer.alloc(1000, 0x41), Buffer.from(EICAR), Buffer.alloc(1000, 0x42)]);
    const r = await clamdScan(body, { port, chunkSize: 7 });
    expect(r.verdict).toBe("INFECTED");
    expect(r.detail).toContain("FOUND");
    expect(received[0]!.equals(body)).toBe(true);
  });

  it("fails closed when clamd is unreachable", async () => {
    const { port } = await fakeClamd();
    await new Promise((r) => server!.close(r));
    server = null;
    const r = await clamdScan(Buffer.from("x"), { port, timeoutMs: 2000 });
    expect(r.verdict).toBe("ERROR");
  });

  it("fails closed on timeout", async () => {
    const { port } = await fakeClamd({ silent: true });
    const r = await clamdScan(Buffer.from("x"), { port, timeoutMs: 200 });
    expect(r).toEqual({ verdict: "ERROR", detail: "clamd timeout after 200ms" });
  });

  it("frames an empty body as command + terminator only", () => {
    expect(encodeInstream(Buffer.alloc(0)).equals(Buffer.concat([Buffer.from("zINSTREAM\0", "latin1"), Buffer.alloc(4)]))).toBe(true);
  });

  it("parses clamd replies strictly", () => {
    expect(parseClamdReply("stream: OK\0")).toBe("CLEAN");
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toBe("INFECTED");
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toBe("ERROR");
    expect(parseClamdReply("")).toBe("ERROR");
  });
});
