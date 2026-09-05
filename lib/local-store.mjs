import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Synchronous writes are atomic within the single-process local development server.
export function localStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = key => path.join(directory, `${encodeURIComponent(key)}.json`);
  const read = key => fs.existsSync(file(key)) ? JSON.parse(fs.readFileSync(file(key), 'utf8')) : null;
  return {
    async getWithMetadata(key) { return read(key); },
    async get(key) { return read(key)?.data ?? null; },
    async setJSON(key, data, options = {}) {
      const old = read(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = randomUUID();
      const temporary = `${file(key)}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ data, etag }));
      fs.renameSync(temporary, file(key));
      return { modified: true, etag };
    },
    async list({ prefix = '' } = {}) { return { blobs: fs.readdirSync(directory).filter(f => f.endsWith('.json')).map(f => ({ key: decodeURIComponent(f.slice(0, -5)) })).filter(b => b.key.startsWith(prefix)) }; },
    async delete(key) { fs.rmSync(file(key), { force: true }); }
  };
}
