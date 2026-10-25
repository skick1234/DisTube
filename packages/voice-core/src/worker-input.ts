import { readSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { AVERROR_EINVAL, AVERROR_EIO, AVERROR_EOF, AVERROR_EXIT, AVSEEK_SIZE, type IOInputCallbacks } from "node-av";
import { type FromWorker, type PermitMessage, type ToWorker, WINDOW_BYTES } from "./protocol.ts";

const FILE_PROBE_BYTES = 256 * 1024;
const REMOTE_PROBE_BYTES = 4 * 1024;

export const remotes = new Map<number, RemoteSource>();

export function post(message: FromWorker | PermitMessage, transfer: ArrayBuffer[] = []): void {
  parentPort?.postMessage(message, transfer);
}

export interface ByteSource {
  readonly callbacks: IOInputCallbacks;
  readonly failure: Error | undefined;
  probe(): Promise<Buffer>;
  waiting(): boolean;
  close(): void | Promise<void>;
}

function seekTarget(offset: bigint, whence: number, position: number, size: number): number | undefined {
  const base = whence & 3;
  const target = base === 0 ? Number(offset) : base === 1 ? position + Number(offset) : size + Number(offset);
  return Number.isSafeInteger(target) && target >= 0 ? target : undefined;
}

export class FileSource implements ByteSource {
  failure: Error | undefined;
  readonly callbacks: IOInputCallbacks;
  readonly #handle: FileHandle;
  readonly #size: number;
  #position = 0;
  #closing?: Promise<void>;

  private constructor(handle: FileHandle, size: number) {
    this.#handle = handle;
    this.#size = size;
    this.callbacks = { read: bytes => this.#read(bytes), seek: (offset, whence) => this.#seek(offset, whence) };
  }

  static async open(path: string): Promise<FileSource> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      const { size } = await handle.stat();
      return new FileSource(handle, size);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      throw new Error(`Playback file could not be opened: ${error instanceof Error ? error.message : ""}`, {
        cause: error,
      });
    }
  }

  async probe(): Promise<Buffer> {
    const bytes = Buffer.alloc(Math.min(this.#size, FILE_PROBE_BYTES));
    const { bytesRead } = await this.#handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  }

  waiting(): boolean {
    return false;
  }

  close(): Promise<void> {
    this.#closing ??= this.#handle.close().catch(() => undefined);
    return this.#closing;
  }

  #read(size: number): Buffer | number {
    if (this.#closing) return AVERROR_EXIT;
    try {
      const bytes = Buffer.allocUnsafe(size);
      const read = readSync(this.#handle.fd, bytes, 0, size, this.#position);
      if (read === 0) return AVERROR_EOF;
      this.#position += read;
      return bytes.subarray(0, read);
    } catch (error: unknown) {
      this.failure = new Error("Playback file could not be read", { cause: error });
      return AVERROR_EIO;
    }
  }

  #seek(offset: bigint, whence: number): bigint | number {
    if (whence & AVSEEK_SIZE) return BigInt(this.#size);
    const target = seekTarget(offset, whence, this.#position, this.#size);
    if (target === undefined) return AVERROR_EINVAL;
    this.#position = target;
    return BigInt(target);
  }
}

class Chunks {
  #chunks: Buffer[] = [];
  length = 0;

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.length += chunk.length;
  }

  take(size: number): Buffer {
    const parts: Buffer[] = [];
    let remaining = Math.min(size, this.length);
    while (remaining > 0) {
      const head = this.#chunks[0] as Buffer;
      if (head.length <= remaining) {
        parts.push(head);
        this.#chunks.shift();
        remaining -= head.length;
      } else {
        parts.push(head.subarray(0, remaining));
        this.#chunks[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    const taken = parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts);
    this.length -= taken.length;
    return taken;
  }

  peek(): Buffer {
    return Buffer.concat(this.#chunks);
  }

  clear(): void {
    this.#chunks = [];
    this.length = 0;
  }
}

export abstract class RemoteSource implements ByteSource {
  failure: Error | undefined;
  readonly track: number;
  readonly input: number;
  protected readonly buffer = new Chunks();
  protected ended = false;
  protected closed = false;
  protected firstWindowFilled = false;
  #waiters: (() => void)[] = [];

  constructor(track: number, input: number) {
    this.track = track;
    this.input = input;
    remotes.set(input, this);
  }

  abstract readonly callbacks: IOInputCallbacks;

  prefill(): Promise<void> {
    return this.until(() => this.firstWindowFilled || this.ended);
  }

  async probe(): Promise<Buffer> {
    await this.until(() => this.buffer.length >= REMOTE_PROBE_BYTES || this.ended);
    return this.buffer.peek();
  }

  waiting(): boolean {
    return this.buffer.length === 0 && !this.ended && !this.failure && !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    remotes.delete(this.input);
    this.buffer.clear();
    this.release();
    this.wake();
  }

  abstract receive(message: Extract<ToWorker, { type: "bytes" }>): void;

  protected abstract release(): void;

  protected abstract consumed(bytes: number): void;

  protected request(fields: { request: number; start?: number; end?: number; want?: number }): void {
    post({ type: "read", track: this.track, input: this.input, ...fields });
  }

  protected fail(error: Error): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    this.release();
    this.wake();
  }

  protected wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  protected async until(settled: () => boolean): Promise<void> {
    while (!settled() && !this.failure && !this.closed) await new Promise<void>(resolve => this.#waiters.push(resolve));
  }

  protected readBytes(size: number): Buffer | number | Promise<Buffer | number> {
    if (this.closed) return AVERROR_EXIT;
    if (this.buffer.length > 0) {
      const chunk = this.buffer.take(size);
      this.consumed(chunk.length);
      return chunk;
    }
    if (this.failure) return AVERROR_EIO;
    if (this.ended) return AVERROR_EOF;
    return new Promise<void>(resolve => this.#waiters.push(resolve)).then(() => this.readBytes(size));
  }
}

let nextRequest = 0;

export class OneShotSource extends RemoteSource {
  readonly callbacks: IOInputCallbacks;
  #requested?: number;

  constructor(track: number, input: number) {
    super(track, input);
    this.callbacks = { read: size => this.readBytes(size) };
    this.#pull();
  }

  receive(message: Extract<ToWorker, { type: "bytes" }>): void {
    if (message.request !== this.#requested) return;
    this.#requested = undefined;
    this.firstWindowFilled = true;
    if (message.failed) this.fail(new Error("Playback input failed"));
    else if (message.done) this.ended = true;
    else if (message.chunk) this.buffer.push(Buffer.from(message.chunk));
    this.wake();
    this.#pull();
  }

  protected consumed(): void {
    this.#pull();
  }

  protected release(): void {
    this.#requested = undefined;
  }

  #pull(): void {
    if (this.#requested !== undefined || this.ended || this.failure || this.closed) return;
    const want = WINDOW_BYTES - this.buffer.length;
    if (want < WINDOW_BYTES / 2) return;
    this.#requested = ++nextRequest;
    this.request({ request: this.#requested, want });
  }
}

export class RangedSource extends RemoteSource {
  readonly callbacks: IOInputCallbacks;
  readonly #size: number;
  #position = 0;
  #fetched = 0;
  #window?: { request: number; end: number };

  constructor(track: number, input: number, size: number) {
    super(track, input);
    this.#size = size;
    this.callbacks = {
      read: bytes => this.readBytes(bytes),
      seek: (offset, whence) => this.#seek(offset, whence),
    };
    this.#fill();
  }

  receive(message: Extract<ToWorker, { type: "bytes" }>): void {
    const window = this.#window;
    if (!window || message.request !== window.request) return;
    if (message.failed) {
      this.#window = undefined;
      this.fail(new Error("Playback input failed"));
      return;
    }
    if (message.chunk) {
      this.buffer.push(Buffer.from(message.chunk));
      this.wake();
    }
    if (!message.done) return;
    this.#window = undefined;
    this.#fetched = window.end + 1;
    this.firstWindowFilled = true;
    this.wake();
    this.#fill();
  }

  async settled(): Promise<void> {
    const window = this.#window;
    if (window) await this.until(() => this.#window !== window);
  }

  protected consumed(bytes: number): void {
    this.#position += bytes;
    this.#fill();
  }

  protected release(): void {
    const window = this.#window;
    this.#window = undefined;
    if (window) post({ type: "cancel", track: this.track, input: this.input, request: window.request });
  }

  #seek(offset: bigint, whence: number): bigint | number {
    if (whence & AVSEEK_SIZE) return BigInt(this.#size);
    const target = seekTarget(offset, whence, this.#position, this.#size);
    if (target === undefined) return AVERROR_EINVAL;
    if (target >= this.#position && target <= this.#position + this.buffer.length) {
      this.buffer.take(target - this.#position);
    } else {
      this.release();
      this.buffer.clear();
      this.#fetched = target;
      this.ended = false;
    }
    this.#position = target;
    this.#fill();
    return BigInt(target);
  }

  #fill(): void {
    if (this.#window || this.closed || this.failure) return;
    if (this.#fetched >= this.#size) {
      this.ended = true;
      this.wake();
      return;
    }
    const room = WINDOW_BYTES - this.buffer.length;
    if (room < WINDOW_BYTES / 2) return;
    const start = this.#fetched;
    const end = Math.min(this.#size, start + room) - 1;
    this.#window = { request: ++nextRequest, end };
    this.request({ request: this.#window.request, start, end });
  }
}
