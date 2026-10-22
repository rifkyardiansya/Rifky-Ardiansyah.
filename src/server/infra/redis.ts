import net from 'node:net';

/**
 * Klien Redis minimal (RESP2) tanpa dependency tambahan.
 *
 * Fase 6memindahkan rate limiter & antrean job dari Map/EventEmitter lokal ke
 * Redis, supaya berbagiproses (beberapa instance aplikasi) dan tahan restart.
 *_repo ini sengaja tidak memakai ioredis_ agar prototipe tetap bisa dijalankan
 * tanpa Docker: bila `REDIS_URL` tidak diisi, semua lapisan yang memakai modul ini
 * otomatis jatuh ke implementasi in-memory (lihat `kv.ts` & `queue.ts`).
 *
 * Yang ditangani di sini:
 *  - lazy connect + reconnect dengan exponential backoff
 *  - pemisahan balasan RESP dengan antrean promise FIFO (satu koneksi = satu urutan)
 *  - timeout per perintah agar request HTTP tidak menggantung saat Redis mati
 *
 * Yang TIDAK ditangani (di luar kebutuhan prototipe): pipeline, cluster,
 * pub/sub, dan sentinel. Semua cukup ditambahkan di file ini tanpa mengubah
 * pemanggil karena kontrak `exec()` tetap sama.
 */

export type Resp = string | number | null | Resp[];

const CRLF = '\r\n';

export class RedisUnavailableError extends Error {
  constructor(message = 'Redis tidak tersedia') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}

/** Balasan `-ERR ...` dari server (mis. WRONGTYPE). Bukan kegagalan koneksi. */
export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisReplyError';
  }
}

interface Pending {
  command: string;
  resolve: (value: Resp) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

type ParseResult =
  | { ok: true; value: Resp; next: number }
  | { ok: false; error: RedisReplyError; next: number }
  | null;

export interface RedisOptions {
  /** Contoh: redis://:password@127.0.0.1:6379/0 */
  url: string;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  maxBackoffMs?: number;
}

/** Meng-encode perintah menjadi array RESP bulk string. */
function encodeCommand(command: string, args: (string | number)[]): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`*${args.length + 1}${CRLF}`));
  parts.push(Buffer.from(`$${Buffer.byteLength(command)}${CRLF}${command}${CRLF}`, 'utf8'));
  for (const arg of args) {
    const value = String(arg);
    parts.push(Buffer.from(`$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`, 'utf8'));
  }
  return Buffer.concat(parts);
}

export class RedisConnection {
  readonly url: string;

  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxBackoffMs: number;

  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Pending[] = [];
  private connecting: Promise<void> | null = null;
  private backoffMs = 200;
  private closed = false;

  /** Dipasang saat koneksi hidup; dipakai health-check & log worker. */
  onStateChange: ((connected: boolean) => void) | null = null;

  constructor(options: RedisOptions) {
    this.url = options.url;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 2000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Menjalankan perintah; melempar {@link RedisUnavailableError} bila tak terhubung. */
  async exec(command: string, ...args: (string | number)[]): Promise<Resp> {
    return this.run(command, args, this.commandTimeoutMs);
  }

  /**
   * Menjalankan perintah dengan batas waktu khusus.
   *
   * Diperlukan untuk perintah blocking (`BRPOPLPUSH`): waktu blokir bisa lebih
   * lama dari timeout default, sehingga timeout perintah harus lebih besar dari
   * jendela blokir — kalau tidak, koneksi diputus tepat sebelum balasan tiba.
   */
  private async run(command: string, args: (string | number)[], timeoutMs: number): Promise<Resp> {
    if (this.closed) throw new RedisUnavailableError('Koneksi Redis ditutup');

    try {
      await this.connect();
    } catch (error) {
      throw error instanceof RedisUnavailableError
        ? error
        : new RedisUnavailableError(error instanceof Error ? error.message : 'gagal terhubung');
    }

    const socket = this.socket;
    if (!socket || socket.destroyed) throw new RedisUnavailableError();

    return new Promise<Resp>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timeout = indikasi Redis menggantung; putuskan koneksi supaya
        // perintah berikutnya tidak ikut antre di koneksi yang rusak.
        this.fail(new RedisUnavailableError(`timeout ${command} setelah ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.push({ command, resolve, reject, timer });

      socket.write(encodeCommand(command, args), (error) => {
        // Error pada `write` berarti koneksi rusak; `fail()` menolak semua
        // perintah yang masih menunggu, termasuk yang baru saja pushed.
        if (error) this.fail(new RedisUnavailableError(error.message));
      });
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.closed) throw new RedisUnavailableError('Koneksi Redis ditutup');
    if (this.connecting) return this.connecting;

    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(this.url);
      } catch {
        reject(new RedisUnavailableError(`REDIS_URL tidak valid: ${this.url}`));
        return;
      }

      const port = Number(url.port || 6379);
      const socket = net.createConnection({ host: url.hostname, port });
      socket.setNoDelay(true);

      const fail = (message: string) => {
        socket.destroy();
        this.fail(new RedisUnavailableError(message));
        reject(new RedisUnavailableError(message));
      };

      const timer = setTimeout(() => fail(`koneksi timeout setelah ${this.connectTimeoutMs}ms`), this.connectTimeoutMs);

      socket.once('error', (error: Error) => fail(error.message));
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        this.attach(socket);
        this.handshake(url).then(resolve, (error: Error) => {
          socket.destroy();
          this.fail(error);
          reject(error);
        });
      });
    });
  }

  /** AUTH + SELECT harus selesai sebelum perintah lain dikirim. */
  private async handshake(url: URL): Promise<void> {
    const password = url.password ? decodeURIComponent(url.password) : '';
    if (password) {
      const user = url.username ? decodeURIComponent(url.username) : null;
      if (user) await this.exec('AUTH', user, password);
      else await this.exec('AUTH', password);
    }

    const db = url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
    if (db) await this.exec('SELECT', db);
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.backoffMs = 200;

    socket.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    socket.on('error', (error: Error) => this.fail(new RedisUnavailableError(error.message)));
    socket.on('close', () => this.fail(new RedisUnavailableError('koneksi Redis tertutup')));

    this.onStateChange?.(true);
  }

  /** Menolak seluruh perintah yang menunggu lalu melepaskan socket. */
  private fail(error: Error) {
    const waiting = this.pending;
    this.pending = [];
    for (const item of waiting) {
      clearTimeout(item.timer);
      item.reject(error);
    }

    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) {
      socket.removeAllListeners('close');
      socket.destroy();
    }

    // Backoff eksponensial: mencegah reconnect Agresif saat Redis sedang restart.
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.onStateChange?.(false);
  }

  /** Menarpikan jawaban satu per satu ke antrean pemanggil (FIFO). */
  private drain() {
    let offset = 0;

    while (this.pending.length > 0) {
      const parsed = this.parse(offset);
      if (parsed === null) break; // balasan belum utuh — tunggu chunk berikutnya
      offset = parsed.next;

      const item = this.pending.shift()!;
      clearTimeout(item.timer);
      if (parsed.ok) item.resolve(parsed.value);
      else item.reject(parsed.error);
    }

    // Buang bytes yang sudah dipasangkan supaya parse berikutnya mulai tepat.
    if (offset > 0) this.buffer = this.buffer.subarray(offset);
  }

  private parse(offset: number): ParseResult {
    const crlf = this.buffer.indexOf(CRLF, offset, 'utf8');
    if (crlf === -1) return null;

    const line = this.buffer.toString('utf8', offset, crlf);
    const type = line[0];
    const rest = line.slice(1);
    const next = crlf + 2;

    switch (type) {
      case '+':
        return { ok: true, value: rest, next };
      case '-':
        return { ok: false, error: new RedisReplyError(rest), next };
      case ':': {
        const value = Number(rest);
        if (Number.isNaN(value)) return { ok: false, error: new RedisReplyError(`integer tidak valid: ${rest}`), next };
        return { ok: true, value, next };
      }
      case '$': {
        const length = Number(rest);
        if (length === -1) return { ok: true, value: null, next };
        if (Number.isNaN(length)) return { ok: false, error: new RedisReplyError(`panjang bulk tidak valid: ${rest}`), next };
        const end = next + length;
        if (this.buffer.length < end + 2) return null; // body belum lengkap
        const value = this.buffer.toString('utf8', next, end);
        return { ok: true, value, next: end + 2 };
      }
      case '*': {
        const count = Number(rest);
        if (count === -1) return { ok: true, value: null, next };
        if (Number.isNaN(count)) return { ok: false, error: new RedisReplyError(`panjang array tidak valid: ${rest}`), next };
        const values: Resp[] = [];
        let cursor = next;
        for (let i = 0; i < count; i += 1) {
          const item = this.parse(cursor);
          if (item === null) return null;
          cursor = item.next;
          if (!item.ok) return item;
          values.push(item.value);
        }
        return { ok: true, value: values, next: cursor };
      }
      default:
        return { ok: false, error: new RedisReplyError(`tipe RESP tidak dikenal: ${type}`), next };
    }
  }

  /* ---------------- Perintah inti (typed) ---------------- */

  async ping(): Promise<boolean> {
    return (await this.exec('PING')) === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    const value = await this.exec('GET', key);
    return typeof value === 'string' ? value : null;
  }

  /** `SET key value [EX seconds]` — variadic agar TTL opsional. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) await this.exec('SET', key, value, 'EX', Math.ceil(ttlSeconds));
    else await this.exec('SET', key, value);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return Number((await this.exec('DEL', ...keys)) ?? 0);
  }

  async exists(key: string): Promise<boolean> {
    return Number((await this.exec('EXISTS', key)) ?? 0) > 0;
  }

  async incr(key: string): Promise<number> {
    return Number((await this.exec('INCR', key)) ?? 0);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.exec('EXPIRE', key, Math.ceil(seconds));
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.exec('ZADD', key, score, member);
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    return Number((await this.exec('ZREMRANGEBYSCORE', key, min, max)) ?? 0);
  }

  async zcard(key: string): Promise<number> {
    return Number((await this.exec('ZCARD', key)) ?? 0);
  }

  /** ZRANGEBYSCORE ... WITHSCORES — balchina bergiliran [member, score, ...]. */
  async zrangebyscoreWithScores(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<{ score: number; member: string }[]> {
    const reply = await this.exec('ZRANGEBYSCORE', key, min, max, 'WITHSCORES');
    if (!Array.isArray(reply)) return [];
    const entries: { score: number; member: string }[] = [];
    for (let i = 0; i + 1 < reply.length; i += 2) {
      const member = reply[i];
      const score = reply[i + 1];
      if (typeof member === 'string') entries.push({ member, score: Number(score) });
    }
    return entries;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    if (values.length === 0) return 0;
    return Number((await this.exec('LPUSH', key, ...values)) ?? 0);
  }

  async rpop(key: string): Promise<string | null> {
    const value = await this.exec('RPOP', key);
    return typeof value === 'string' ? value : null;
  }

  async llen(key: string): Promise<number> {
    return Number((await this.exec('LLEN', key)) ?? 0);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const reply = await this.exec('LRANGE', key, start, stop);
    return Array.isArray(reply) ? reply.filter((v): v is string => typeof v === 'string') : [];
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    const value = await this.exec('RPOPLPUSH', source, destination);
    return typeof value === 'string' ? value : null;
  }

  /** Versi-blocking RPOPLPUSH; null bila tidak ada item dalam `timeoutSeconds`. */
  async brpoplpush(source: string, destination: string, timeoutSeconds: number): Promise<string | null> {
    const block = Math.max(1, Math.ceil(timeoutSeconds));
    // Timeout perintah harus melampaui jendela blokir, dengan jeda 1 detik
    // untuk 시간 reply di jaringan.
    const value = await this.run('BRPOPLPUSH', [source, destination, block], block * 1000 + 1000);
    return typeof value === 'string' ? value : null;
  }

  /** Menghapus N kemunculan pertama `value` dari list (LREM key 0 value). */
  async lrem(key: string, value: string): Promise<number> {
    return Number((await this.exec('LREM', key, 0, value)) ?? 0);
  }

  close() {
    this.closed = true;
    this.fail(new RedisUnavailableError('ditutup oleh aplikasi'));
    this.onStateChange = null;
  }
}

/* ---------------- Singleton proses ---------------- */

declare global {
  // eslint-disable-next-line no-var
  var __restoRedis: RedisConnection | undefined;
}

export function redisUrl(): string {
  return (process.env.REDIS_URL ?? '').trim();
}

export function isRedisConfigured(): boolean {
  return redisUrl().length > 0;
}

/**
 * Koneksi Redis proses ini, atau `null` bila `REDIS_URL` tidak diisi.
 * Mengembalikan `null` (bukan melempar) penting agar aplikasi tetap bisa jalan
 * di laptop yang tidak punya Redis.
 */
export function getRedis(): RedisConnection | null {
  const url = redisUrl();
  if (!url) return null;
  if (!global.__restoRedis || global.__restoRedis.url !== url) {
    global.__restoRedis?.close();
    global.__restoRedis = new RedisConnection({ url });
  }
  return global.__restoRedis;
}

/** Membuang singleton (dipakai test & saat worker berhenti). */
export function resetRedis() {
  global.__restoRedis?.close();
  global.__restoRedis = undefined;
}

/** Status ringkas untuk `/api/health`. Tidak melakukan koneksi jaringan. */
export function redisStatus(): { configured: boolean; url: string | null; connected: boolean } {
  const connection = isRedisConfigured() ? getRedis() : null;
  return {
    configured: isRedisConfigured(),
    // Jangan pernah bocorkan password di response API.
    url: connection ? connection.url.replace(/\/\/[^@]*@/, '//***@') : null,
    connected: connection?.connected ?? false,
  };
}
