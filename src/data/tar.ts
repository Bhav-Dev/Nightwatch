/**
 * A small writer and reader for plain, uncompressed tar archives (POSIX ustar). The labelling
 * export bundles a few nights of sound into one file, because the share sheet takes a single
 * file; the laptop tools read it back. Only regular files with ASCII names of up to 100 bytes
 * are written, which is all the export needs. No React Native imports: file access is passed
 * in, so the same code runs on the phone, in Jest and in tools/labelling.
 */

export const TAR_BLOCK = 512;

/** Largest file a ustar header can describe (11 octal digits). */
const MAX_SIZE = 8 ** 11 - 1;

function writeAscii(block: Uint8Array, offset: number, length: number, s: string): void {
  for (let i = 0; i < s.length && i < length; i++) block[offset + i] = s.charCodeAt(i);
}

/** `value` as zero-padded octal digits followed by a NUL, filling `length` bytes. */
function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

/** Bytes needed to pad `size` bytes of contents to a whole block. */
export function tarPaddingBytes(size: number): number {
  return (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
}

/** The 512-byte ustar header for a regular file. */
export function tarHeader(name: string, size: number, mtimeS: number): Uint8Array {
  if (name.length === 0 || name.length > 100 || !/^[\x20-\x7e]+$/.test(name)) {
    throw new Error(`tar: name must be 1 to 100 printable ASCII characters: ${name}`);
  }
  if (!Number.isInteger(size) || size < 0 || size > MAX_SIZE) throw new Error(`tar: bad size ${size} for ${name}`);
  const h = new Uint8Array(TAR_BLOCK);
  writeAscii(h, 0, 100, name);
  writeAscii(h, 100, 8, octal(0o644, 8)); // mode
  writeAscii(h, 108, 8, octal(0, 8)); // uid
  writeAscii(h, 116, 8, octal(0, 8)); // gid
  writeAscii(h, 124, 12, octal(size, 12));
  writeAscii(h, 136, 12, octal(Math.max(0, Math.floor(mtimeS)), 12));
  writeAscii(h, 156, 1, '0'); // regular file
  writeAscii(h, 257, 6, 'ustar\0');
  writeAscii(h, 263, 2, '00');
  // The checksum is the byte sum of the header with its own field read as eight spaces.
  writeAscii(h, 148, 8, '        ');
  const sum = h.reduce((s, b) => s + b, 0);
  writeAscii(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}

/** Size of an archive holding files of these sizes, end marker included. */
export function tarSize(sizes: readonly number[]): number {
  return sizes.reduce((total, size) => total + TAR_BLOCK + size + tarPaddingBytes(size), 2 * TAR_BLOCK);
}

/** A file to put in an archive: small contents in memory, or a file read in chunks. */
export interface TarInput {
  name: string;
  size: number;
  data?: Uint8Array;
  path?: string;
}

export interface TarFileReader {
  /** Up to `length` bytes from the current position; fewer (or none) at the end of the file. */
  read(length: number): Uint8Array;
  close(): void;
}

export interface TarWriteOptions {
  mtimeS: number;
  /** Opens a file named by an input's `path`. */
  open?: (path: string) => TarFileReader;
  /** Bytes copied per read; the default is 1 MB. */
  chunkBytes?: number;
  /** Called after each chunk, and awaited, so a long copy can let the UI update. */
  onProgress?: (written: number, total: number) => void | Promise<void>;
}

/**
 * Streams an archive to `write`, one header, chunk or padding at a time, so an archive larger
 * than memory can be written. Throws if a file is shorter or longer than its stated size,
 * since the header has already been written.
 */
export async function writeTar(inputs: readonly TarInput[], write: (bytes: Uint8Array) => void, opts: TarWriteOptions): Promise<void> {
  const total = tarSize(inputs.map((i) => i.size));
  const chunk = opts.chunkBytes ?? 1 << 20;
  let written = 0;
  const put = (bytes: Uint8Array) => {
    write(bytes);
    written += bytes.length;
  };
  for (const input of inputs) {
    put(tarHeader(input.name, input.size, opts.mtimeS));
    if (input.data) {
      if (input.data.length !== input.size) throw new Error(`tar: ${input.name} is ${input.data.length} bytes, not ${input.size}`);
      put(input.data);
    } else if (input.path !== undefined && input.size > 0) {
      if (!opts.open) throw new Error('tar: no way to open files');
      const file = opts.open(input.path);
      try {
        let copied = 0;
        while (copied < input.size) {
          const bytes = file.read(Math.min(chunk, input.size - copied));
          if (bytes.length === 0) throw new Error(`tar: ${input.path} is shorter than ${input.size} bytes`);
          put(bytes);
          copied += bytes.length;
          await opts.onProgress?.(written, total);
        }
        if (file.read(1).length > 0) throw new Error(`tar: ${input.path} is longer than ${input.size} bytes`);
      } finally {
        file.close();
      }
    } else if (input.size > 0) {
      throw new Error(`tar: ${input.name} has no contents`);
    }
    const pad = tarPaddingBytes(input.size);
    if (pad > 0) put(new Uint8Array(pad));
    await opts.onProgress?.(written, total);
  }
  put(new Uint8Array(2 * TAR_BLOCK));
  await opts.onProgress?.(written, total);
}

/** A whole archive in memory, for small archives and tests. */
export function buildTar(files: readonly { name: string; data: Uint8Array }[], mtimeS = 0): Uint8Array {
  const out = new Uint8Array(tarSize(files.map((f) => f.data.length)));
  let at = 0;
  for (const f of files) {
    out.set(tarHeader(f.name, f.data.length, mtimeS), at);
    out.set(f.data, at + TAR_BLOCK);
    at += TAR_BLOCK + f.data.length + tarPaddingBytes(f.data.length);
  }
  return out;
}

export interface TarEntry {
  name: string;
  size: number;
  /** Where the file's contents start in the archive. */
  offset: number;
}

function readAscii(block: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = offset; i < offset + length && block[i] !== 0; i++) s += String.fromCharCode(block[i]);
  return s;
}

function readOctal(block: Uint8Array, offset: number, length: number, what: string): number {
  if (block[offset] & 0x80) throw new Error(`tar: ${what} uses a base-256 size, which is not supported`);
  const s = readAscii(block, offset, length).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error(`tar: bad number in ${what}`);
  return s === '' ? 0 : parseInt(s, 8);
}

/**
 * Lists the regular files in an archive of `size` bytes, reading headers through
 * `read(offset, length)` so the archive never has to be in memory. Directories, links and
 * extended headers are skipped.
 */
export function listTar(read: (offset: number, length: number) => Uint8Array, size: number): TarEntry[] {
  const entries: TarEntry[] = [];
  let at = 0;
  while (at + TAR_BLOCK <= size) {
    const h = read(at, TAR_BLOCK);
    if (h.length < TAR_BLOCK) throw new Error('tar: archive ends in the middle of a header');
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== readOctal(h, 148, 8, 'checksum')) throw new Error(`tar: bad header checksum at byte ${at}`);
    const name = readAscii(h, 0, 100);
    const prefix = readAscii(h, 257, 6) === 'ustar' ? readAscii(h, 345, 155) : '';
    const fileSize = readOctal(h, 124, 12, name);
    const type = String.fromCharCode(h[156]);
    if (type === '0' || type === '\0') {
      if (at + TAR_BLOCK + fileSize > size) throw new Error(`tar: ${name} runs past the end of the archive`);
      entries.push({ name: prefix ? `${prefix}/${name}` : name, size: fileSize, offset: at + TAR_BLOCK });
    }
    at += TAR_BLOCK + fileSize + tarPaddingBytes(fileSize);
  }
  return entries;
}
