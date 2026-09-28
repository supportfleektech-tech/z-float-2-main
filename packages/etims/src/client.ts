/**
 * eTIMS transport clients.
 *
 *  - OscuHttpClient: KRA-hosted OSCU (or a self-hosted VSCU jar — same API).
 *    Documented endpoints only (OSCU Specification v2.0):
 *      POST /selectInitOsdcInfo   device initialisation → cmcKey, sdcId, mrcNo
 *      POST /saveTrnsSalesOsdc    save sales transaction → receipt signature
 *      POST /selectCustomer       customer (buyer) PIN lookup
 *    Every call after initialisation carries tin / bhfId / cmcKey headers.
 *    resultCd "000" = success. Fail-closed when the device is not initialised.
 *
 *  - SandboxEtimsClient: deterministic local signer for dev/demo. Output is
 *    realistic in shape but is NOT a KRA signature — documents signed by it
 *    are flagged `sandbox=true` and rendered "SANDBOX — NOT A VALID TAX INVOICE".
 */
import { createHmac } from "node:crypto";
import { getConfig } from "@zfloat/config";
import { kraDateTime } from "./payload.js";

export interface DeviceIdentity {
  tin: string;
  bhfId: string;
  deviceSerial: string;
  cmcKey?: string | null;
}

export interface InitResult {
  cmcKey: string;
  sdcId: string;
  mrcNo: string;
  taxpayerName?: string;
  raw: Record<string, unknown>;
}

export interface SaleSignature {
  rcptNo: number;
  totRcptNo: number;
  intrlData: string;
  rcptSign: string;
  sdcId: string;
  mrcNo: string;
  vsdcRcptPbctDate: string;
  raw: Record<string, unknown>;
}

export interface CustomerPinInfo {
  tin: string;
  name: string;
  status?: string;
  raw: Record<string, unknown>;
}

export interface EtimsClient {
  readonly driver: "sandbox" | "oscu" | "vscu";
  readonly environment: "sandbox" | "production";
  initialise(device: DeviceIdentity): Promise<InitResult>;
  saveSale(device: DeviceIdentity, payload: Record<string, unknown>): Promise<SaleSignature>;
  lookupCustomerPin(device: DeviceIdentity, customerTin: string): Promise<CustomerPinInfo | null>;
}

export class EtimsError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "DEVICE_NOT_INITIALISED" | "REJECTED" | "UNAVAILABLE" | "TIMEOUT" | "BAD_RESPONSE",
    /** Transient failures are retried by the outbox; rejections need a human. */
    readonly retryable: boolean,
    readonly resultCd?: string,
  ) {
    super(message);
    this.name = "EtimsError";
  }
}

const OSCU_BASE_URLS = {
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
} as const;

export class OscuHttpClient implements EtimsClient {
  constructor(
    readonly driver: "oscu" | "vscu",
    readonly environment: "sandbox" | "production",
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async post(path: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && /timeout|abort/i.test(err.name + err.message);
      throw new EtimsError(`eTIMS ${path} ${timeout ? "timed out" : "unreachable"}`, timeout ? "TIMEOUT" : "UNAVAILABLE", true);
    }
    if (res.status >= 500) throw new EtimsError(`eTIMS ${path} HTTP ${res.status}`, "UNAVAILABLE", true);
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new EtimsError(`eTIMS ${path} returned non-JSON (HTTP ${res.status})`, "BAD_RESPONSE", res.status >= 500);
    }
    const resultCd = String(json.resultCd ?? "");
    if (resultCd !== "000") {
      // 001 = "no search result" (lookups) — callers handle it.
      if (resultCd === "001") return json;
      throw new EtimsError(`eTIMS ${path} rejected: [${resultCd}] ${String(json.resultMsg ?? "unknown error")}`, "REJECTED", false, resultCd);
    }
    return json;
  }

  private authHeaders(device: DeviceIdentity): Record<string, string> {
    if (!device.cmcKey) {
      throw new EtimsError("eTIMS device is not initialised (no cmcKey) — run device initialisation first", "DEVICE_NOT_INITIALISED", false);
    }
    return { tin: device.tin, bhfId: device.bhfId, cmcKey: device.cmcKey };
  }

  async initialise(device: DeviceIdentity): Promise<InitResult> {
    const json = await this.post("/selectInitOsdcInfo", { tin: device.tin, bhfId: device.bhfId, dvcSrlNo: device.deviceSerial }, {});
    const data = (json.data ?? {}) as Record<string, unknown>;
    const info = (data.info ?? data) as Record<string, unknown>;
    const cmcKey = String(info.cmcKey ?? json.cmcKey ?? "");
    if (!cmcKey) throw new EtimsError("selectInitOsdcInfo returned no cmcKey", "BAD_RESPONSE", false);
    return {
      cmcKey,
      sdcId: String(info.sdcId ?? ""),
      mrcNo: String(info.mrcNo ?? ""),
      taxpayerName: info.taxprNm ? String(info.taxprNm) : undefined,
      raw: { ...json, data: { ...data, info: { ...info, cmcKey: "***redacted***" } } },
    };
  }

  async saveSale(device: DeviceIdentity, payload: Record<string, unknown>): Promise<SaleSignature> {
    const json = await this.post("/saveTrnsSalesOsdc", payload, this.authHeaders(device));
    const d = (json.data ?? {}) as Record<string, unknown>;
    if (!d.rcptSign || !d.intrlData) throw new EtimsError("saveTrnsSalesOsdc response missing signature", "BAD_RESPONSE", false);
    return {
      rcptNo: Number(d.rcptNo ?? 0),
      totRcptNo: Number(d.totRcptNo ?? 0),
      intrlData: String(d.intrlData),
      rcptSign: String(d.rcptSign),
      sdcId: String(d.sdcId ?? ""),
      mrcNo: String(d.mrcNo ?? ""),
      vsdcRcptPbctDate: String(d.vsdcRcptPbctDate ?? ""),
      raw: json,
    };
  }

  async lookupCustomerPin(device: DeviceIdentity, customerTin: string): Promise<CustomerPinInfo | null> {
    const json = await this.post("/selectCustomer", { tin: device.tin, bhfId: device.bhfId, custmTin: customerTin }, this.authHeaders(device));
    const list = ((json.data as Record<string, unknown> | undefined)?.custList ?? []) as Record<string, unknown>[];
    const c = list[0];
    if (!c) return null;
    return { tin: String(c.tin ?? customerTin), name: String(c.taxprNm ?? ""), status: c.taxprSttsCd ? String(c.taxprSttsCd) : undefined, raw: c };
  }
}

/** Deterministic, offline signer (dev/demo/tests). Never produces real KRA signatures. */
export class SandboxEtimsClient implements EtimsClient {
  readonly driver = "sandbox" as const;
  readonly environment = "sandbox" as const;
  constructor(private readonly secret: string = getConfig().ETIMS_SANDBOX_SECRET) {}

  private h(input: string): string {
    return createHmac("sha256", this.secret).update(input).digest("hex").toUpperCase();
  }

  private digits(input: string, n: number): string {
    const hex = this.h(input);
    let out = "";
    for (let i = 0; out.length < n; i++) out += (parseInt(hex[i % hex.length]!, 16) % 10).toString();
    return out;
  }

  async initialise(device: DeviceIdentity): Promise<InitResult> {
    const seed = `${device.tin}|${device.bhfId}|${device.deviceSerial}`;
    return {
      cmcKey: `SBX-${this.h(`cmc|${seed}`).slice(0, 40)}`,
      sdcId: `KRACU0${this.digits(`sdc|${seed}`, 9)}`,
      mrcNo: `KRAMW0${this.digits(`mrc|${seed}`, 9)}`,
      taxpayerName: undefined,
      raw: { resultCd: "000", resultMsg: "It is succeeded (sandbox)", sandbox: true },
    };
  }

  async saveSale(device: DeviceIdentity, payload: Record<string, unknown>): Promise<SaleSignature> {
    if (!device.cmcKey) throw new EtimsError("sandbox device not initialised", "DEVICE_NOT_INITIALISED", false);
    const invcNo = Number(payload.invcNo ?? 0);
    const basis = `${device.tin}|${device.bhfId}|${invcNo}|${String(payload.totAmt)}|${String(payload.rcptTyCd)}`;
    const sig = this.h(`sign|${basis}`);
    const init = await this.initialise(device);
    return {
      rcptNo: invcNo,
      totRcptNo: invcNo,
      intrlData: this.h(`intrl|${basis}`).replace(/[^A-Z2-7]/g, "").padEnd(26, "Q").slice(0, 26),
      rcptSign: sig.slice(0, 16),
      sdcId: init.sdcId,
      mrcNo: init.mrcNo,
      vsdcRcptPbctDate: kraDateTime(new Date()),
      raw: { resultCd: "000", resultMsg: "It is succeeded (sandbox)", sandbox: true },
    };
  }

  async lookupCustomerPin(_device: DeviceIdentity, customerTin: string): Promise<CustomerPinInfo | null> {
    return { tin: customerTin, name: "", status: "A", raw: { sandbox: true } };
  }
}

/** Resolve the configured client. Throws NOT_CONFIGURED when eTIMS is disabled. */
export function createEtimsClient(): EtimsClient {
  const c = getConfig();
  switch (c.ETIMS_DRIVER) {
    case "sandbox":
      return new SandboxEtimsClient(c.ETIMS_SANDBOX_SECRET);
    case "oscu":
      return new OscuHttpClient("oscu", c.ETIMS_ENVIRONMENT, c.ETIMS_API_BASE_URL || OSCU_BASE_URLS[c.ETIMS_ENVIRONMENT], c.ETIMS_TIMEOUT_MS);
    case "vscu":
      if (!c.ETIMS_API_BASE_URL) {
        throw new EtimsError("ETIMS_DRIVER=vscu requires ETIMS_API_BASE_URL (the VSCU jar, e.g. http://vscu:8088)", "NOT_CONFIGURED", false);
      }
      return new OscuHttpClient("vscu", c.ETIMS_ENVIRONMENT, c.ETIMS_API_BASE_URL, c.ETIMS_TIMEOUT_MS);
    case "disabled":
    default:
      throw new EtimsError("eTIMS is disabled (ETIMS_DRIVER=disabled)", "NOT_CONFIGURED", false);
  }
}
