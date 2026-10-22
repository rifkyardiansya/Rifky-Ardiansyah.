import net from 'node:net';

/**
 * Server Redis palsu (in-process) untuk pengujian.
 *
 * Menfellowi subset perintah RESP yang dipakai `src/server/infra/redis.ts` —
 * persis cukup untuk menguji rate limiter Redis, antrean job, dan penjadwal
 * tanpa perlu Redis sungguhan di mesin / CI.
 *
 * Ini bukan pengganti Redis: tidak ada persistence, clustering, atau scripting
 * Lua. Tujuannya hanya memvalidasi bahwa klien RESP kita benar dan bahwa logika
 * distributed di atasnya berperilaku sama dengan versi in-memory.
 */

type Value = string | number;

interface Entry {
  value: Value;
  expiresAt: number | null;
}

interface FakeRedisData {
  strings: Map<string, Entry>;
  sortedSets: Map<string, Map<string, { score: number; expiresAt: number | null }>>;
  lists: Map<string, { items: string[]; expiresAt: number | null }>;
}

export interface FakeRedisServer {
  url: string;
  /** Jumlah perintah yang diterima (berguna untuk memastikan client bicara). */
  commands: string[];
  close(): Promise<void>;
  flush(): void;
}

/** Menulis balasan RESP dari nilai JavaScript. */
function encode(value: unknown): Buffer {
  if (value === null) return Buffer.from('$-1\r\n', 'utf8');
  if (typeof value === 'number') return Buffer.from(`:${value}\r\n`, 'utf8');
  if (typeof value === 'string') {
    return Buffer.from(`$${Buffer.byteLength(value)}\r\n${value}\r\n`, 'utf8');
  }
  if (Array.isArray(value)) {
    const head = Buffer.from(`*${value.length}\r\n`, 'utf8');
    return Buffer.concat([head, ...value.map(encode)]);
  }
  return Buffer.from('$-1\r\n', 'utf8');
}

/** Membaca satu perintah RESP dari buffer; null bila belum lengkap. */
function parseCommand(buffer: Buffer): { args: string[]; rest: Buffer } | null {
  const text = buffer.toString('utf8');
  if (!text.startsWith('*')) return null;

  const end = text.indexOf('\r\n');
  if (end === -1) return null;

  const count = Number(text.slice(1, end));
  if (!Number.isFinite(count)) return null;

  let cursor = end + 2;
  const args: string[] = [];

  for (let i = 0; i < count; i += 1) {
    if (text[cursor] !== '$') return null;
    const lineEnd = text.indexOf('\r\n', cursor);
    if (lineEnd === -1) return null;
    const length = Number(text.slice(cursor + 1, lineEnd));
    const start = lineEnd + 2;
    if (text.length < start + length + 2) return null;
    args.push(text.slice(start, start + length));
    cursor = start + length + 2;
  }

  return { args, rest: buffer.subarray(Buffer.byteLength(text.slice(0, cursor), 'utf8')) };
}

export async function startFakeRedis(port = 0): Promise<FakeRedisServer> {
  const data: FakeRedisData = { strings: new Map(), sortedSets: new Map(), lists: new Map() };
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();

  const now = () => Date.now();

  function liveStrings(): Map<string, Entry> {
    for (const [key, entry] of data.strings) {
      if (entry.expiresAt !== null && entry.expiresAt <= now()) data.strings.delete(key);
    }
    return data.strings;
  }

  function liveSortedSets(): Map<string, Map<string, { score: number; expiresAt: number | null }>> {
    for (const [key, set] of data.sortedSets) {
      for (const [member, entry] of set) {
        if (entry.expiresAt !== null && entry.expiresAt <= now()) set.delete(member);
      }
      if (set.size === 0) data.sortedSets.delete(key);
    }
    return data.sortedSets;
  }

  function liveLists(): Map<string, { items: string[]; expiresAt: number | null }> {
    for (const [key, list] of data.lists) {
      if (list.expiresAt !== null && list.expiresAt <= now()) data.lists.delete(key);
    }
    return data.lists;
  }

  function list(key: string) {
    const lists = liveLists();
    let entry = lists.get(key);
    if (!entry) {
      entry = { items: [], expiresAt: null };
      lists.set(key, entry);
    }
    return entry;
  }

  function sortedSet(key: string) {
    const sets = liveSortedSets();
    let set = sets.get(key);
    if (!set) {
      set = new Map();
      sets.set(key, set);
    }
    return set;
  }

  function run(args: string[]): unknown {
    const command = args[0]?.toUpperCase() ?? '';
    const key = args[1];

    const ZSET_COMMANDS = new Set(['ZADD', 'ZREMRANGEBYSCORE', 'ZCARD', 'ZRANGEBYSCORE']);
    const LIST_COMMANDS = new Set(['LPUSH', 'RPOP', 'LLEN', 'LRANGE', 'RPOPLPUSH', 'BRPOPLPUSH', 'LREM']);

    // Redis menolak salah tipe dengan WRONGTYPE — ditiru agar error handling
    // klien (reply error vs kegagalan koneksi) ikut teruji.
    if (key !== undefined) {
      if (ZSET_COMMANDS.has(command) && data.strings.has(key)) {
        throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
      }
      if (LIST_COMMANDS.has(command) && data.strings.has(key)) {
        throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
      }
    }

    switch (command) {
      case 'PING':
        return 'PONG';

      case 'AUTH':
      case 'SELECT':
        return 'OK';

      case 'SET': {
        let ttl: number | null = null;
        const exIndex = args.findIndex((a) => a.toUpperCase() === 'EX');
        if (exIndex !== -1) ttl = now() + Number(args[exIndex + 1]) * 1000;
        data.strings.set(args[1], { value: args[2], expiresAt: ttl });
        return 'OK';
      }

      case 'GET': {
        const entry = liveStrings().get(args[1]);
        return entry ? entry.value : null;
      }

      case 'DEL': {
        let removed = 0;
        for (const k of args.slice(1)) {
          if (data.strings.delete(k)) removed += 1;
          if (data.sortedSets.delete(k)) removed += 1;
          if (data.lists.delete(k)) removed += 1;
        }
        return removed;
      }

      case 'EXISTS': {
        const exists =
          data.strings.has(args[1]) || data.sortedSets.has(args[1]) || data.lists.has(args[1]);
        return exists ? 1 : 0;
      }

      case 'INCR': {
        const strings = liveStrings();
        const entry = strings.get(args[1]);
        const next = Number(entry?.value ?? 0) + 1;
        // Redis menyimpan string key sebagai byte string; balasan GET juga bulk
        // string (bukan integer), jadi nilai disimpan dalam bentuk string.
        strings.set(args[1], { value: String(next), expiresAt: entry?.expiresAt ?? null });
        return next;
      }

      case 'EXPIRE': {
        const strings = liveStrings();
        const entry = strings.get(args[1]);
        if (!entry) return 0;
        entry.expiresAt = now() + Number(args[2]) * 1000;
        return 1;
      }

      case 'ZADD': {
        const set = sortedSet(args[1]);
        set.set(args[3], { score: Number(args[2]), expiresAt: null });
        return 1;
      }

      case 'ZREMRANGEBYSCORE': {
        const set = sortedSet(args[1]);
        const min = args[2] === '-inf' ? -Infinity : Number(args[2]);
        const max = args[3] === '+inf' ? Infinity : Number(args[3]);
        let removed = 0;
        for (const [member, entry] of set) {
          if (entry.score >= min && entry.score <= max) {
            set.delete(member);
            removed += 1;
          }
        }
        return removed;
      }

      case 'ZCARD':
        return sortedSet(args[1]).size;

      case 'ZRANGEBYSCORE': {
        const min = args[2] === '-inf' ? -Infinity : Number(args[2]);
        const max = args[3] === '+inf' ? Infinity : Number(args[3]);
        const entries = [...sortedSet(args[1]).entries()]
          .filter(([, entry]) => entry.score >= min && entry.score <= max)
          .sort((a, b) => a[1].score - b[1].score);

        const flat: unknown[] = [];
        for (const [member, entry] of entries) {
          flat.push(member);
          if (args[4]?.toUpperCase() === 'WITHSCORES') flat.push(entry.score);
        }
        return flat;
      }

      case 'LPUSH': {
        const entry = list(args[1]);
        for (const value of args.slice(2)) entry.items.unshift(value);
        return entry.items.length;
      }

      case 'RPOP': {
        const entry = list(args[1]);
        return entry.items.pop() ?? null;
      }

      case 'LLEN':
        return list(args[1]).items.length;

      case 'LRANGE': {
        const items = list(args[1]).items;
        const start = Number(args[2]);
        const stop = Number(args[3]);
        return items.slice(start < 0 ? items.length + start : start, stop < 0 ? items.length + stop + 1 : stop + 1);
      }

      case 'RPOPLPUSH': {
        const value = list(args[1]).items.pop() ?? null;
        if (value !== null) list(args[2]).items.unshift(value);
        return value;
      }

      case 'BRPOPLPUSH': {
        // Redis asli hanya memblokir koneksi ini, sedangkan di sini socket satu
        //-satunya sehingga `Atomics.wait` memblokir seluruh proses test.
        // Karena itu durasi blokir dibatasi 250 ms; worker tetap langsung
        // mengambil job karena ia memanggil ulang perintah blocking berkala.
        const requested = Number(args[3]);
        const waitMs = Math.min(requested * 1000, 250);
        const deadline = Date.now() + waitMs;
        for (;;) {
          const source = list(args[1]);
          if (source.items.length > 0) {
            const value = source.items.pop() as string;
            list(args[2]).items.unshift(value);
            return value;
          }
          if (Date.now() >= deadline) return null;
          // Meniru penundaan tanpa memblokir event loop test.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }

      case 'LREM': {
        const entry = list(args[1]);
        let removed = 0;
        for (let i = 0; i < entry.items.length; ) {
          if (entry.items[i] === args[3]) {
            entry.items.splice(i, 1);
            removed += 1;
          } else {
            i += 1;
          }
        }
        return removed;
      }

      default:
        void key;
        throw new Error(`ERR unknown command '${command}'`);
    }
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer: Buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        const parsed = parseCommand(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        commands.push(parsed.args[0] ?? '');

        try {
          socket.write(encode(run(parsed.args)));
        } catch (error) {
          socket.write(Buffer.from(`-ERR ${(error as Error).message}\r\n`, 'utf8'));
        }
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('gagal menjalankan fake redis');

  return {
    url: `redis://127.0.0.1:${address.port}`,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    flush() {
      data.strings.clear();
      data.sortedSets.clear();
      data.lists.clear();
      commands.length = 0;
    },
  };
}
