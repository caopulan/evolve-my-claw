import crypto from "node:crypto";
import { WebSocket } from "ws";
import { buildDeviceAuthPayload } from "./device-auth.js";
import {
  defaultIdentityPath,
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "./device-identity.js";

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: { deviceToken?: string; role?: string; scopes?: string[] };
};

export type GatewayCaptureOptions = {
  url: string;
  token?: string;
  password?: string;
  stateDir?: string;
  onEvent?: (evt: GatewayEventFrame) => void;
  onHello?: (hello: GatewayHelloOk) => void;
  onError?: (err: Error) => void;
  onClose?: (code: number, reason: string) => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class GatewayCaptureClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectNonce: string | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private connectSent = false;

  constructor(private opts: GatewayCaptureOptions) {}

  start() {
    this.ws = new WebSocket(this.opts.url);
    this.ws.on("open", () => this.queueConnect());
    this.ws.on("message", (data) => this.handleMessage(String(data)));
    this.ws.on("error", (err) => this.opts.onError?.(err instanceof Error ? err : new Error(String(err))));
    this.ws.on("close", (code, reason) => {
      this.opts.onClose?.(code, String(reason));
    });
  }

  stop() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.pending.clear();
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = setTimeout(() => this.sendConnect(), 750);
  }

  private sendConnect() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const identityPath = defaultIdentityPath(this.opts.stateDir);
    const identity = loadOrCreateDeviceIdentity(identityPath);
    const signedAtMs = Date.now();
    const role = "operator";
    const scopes = ["operator.admin"];
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: "gateway-client",
      clientMode: "backend",
      role,
      scopes,
      signedAtMs,
      token: this.opts.token ?? null,
      nonce: this.connectNonce ?? null,
    });
    const signature = signDevicePayload(identity.privateKeyPem, payload);
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "gateway-client",
        displayName: "evolve-my-claw",
        version: "dev",
        platform: process.platform,
        mode: "backend",
      },
      caps: ["tool-events"],
      role,
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce: this.connectNonce ?? undefined,
      },
      auth: this.opts.token || this.opts.password ? { token: this.opts.token, password: this.opts.password } : undefined,
    };
    void this.request<GatewayHelloOk>("connect", params)
      .then((hello) => this.opts.onHello?.(hello))
      .catch((err) => {
        this.opts.onError?.(err);
        this.ws?.close(1008, "connect failed");
      });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const frame = parsed as { type?: unknown };
    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          this.sendConnect();
        }
        return;
      }
      this.opts.onEvent?.(evt);
      return;
    }
    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(new Error(res.error?.message ?? "request failed"));
      }
      return;
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = crypto.randomUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }
}
