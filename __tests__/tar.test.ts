import { buildTar, listTar, TAR_BLOCK, tarHeader, tarPaddingBytes, tarSize, writeTar, type TarFileReader } from '../src/data/tar';

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const reader = (archive: Uint8Array) => (offset: number, length: number) => archive.subarray(offset, offset + length);

describe('tar', () => {
  it('writes a ustar header with the name, octal size and time, and a valid checksum', () => {
    const h = tarHeader('night/segment-001.m4a', 1234, 1_760_000_000);
    expect(h.length).toBe(TAR_BLOCK);
    expect(ascii(h, 0, 21)).toBe('night/segment-001.m4a');
    expect(h[21]).toBe(0);
    expect(ascii(h, 100, 108)).toBe('0000644\0');
    expect(ascii(h, 124, 136)).toBe('00000002322\0'); // 1234 in octal
    expect(parseInt(ascii(h, 136, 147), 8)).toBe(1_760_000_000);
    expect(ascii(h, 156, 157)).toBe('0');
    expect(ascii(h, 257, 265)).toBe('ustar\u000000');
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    expect(ascii(h, 148, 156)).toBe(sum.toString(8).padStart(6, '0') + '\0 ');
  });

  it('refuses names a plain ustar header cannot hold', () => {
    expect(() => tarHeader('x'.repeat(101), 1, 0)).toThrow(/100/);
    expect(() => tarHeader('', 1, 0)).toThrow();
    expect(() => tarHeader('nuit-été.json', 1, 0)).toThrow(/ASCII/);
    expect(() => tarHeader('ok.json', -1, 0)).toThrow(/size/);
  });

  it('pads contents to whole blocks and ends with two empty blocks', () => {
    expect([0, 1, 511, 512, 513].map(tarPaddingBytes)).toEqual([0, 511, 1, 0, 511]);
    expect(tarSize([])).toBe(1024);
    expect(tarSize([1, 512, 0])).toBe(3 * 512 + 512 + 512 + 1024);
    const archive = buildTar([{ name: 'a.txt', data: bytes(10) }]);
    expect(archive.length).toBe(tarSize([10]));
    expect(archive.subarray(512 + 10).every((b) => b === 0)).toBe(true);
  });

  it('reads back what it wrote, without holding the archive in one read', () => {
    const files = [
      { name: 'export/export.json', data: bytes(70) },
      { name: 'export/2026-10-15-2304/night.json', data: bytes(512, 2) },
      { name: 'export/2026-10-15-2304/segment-001.m4a', data: bytes(5000, 3) },
      { name: 'export/empty', data: new Uint8Array(0) },
    ];
    const archive = buildTar(files, 1_760_000_000);
    const reads: number[] = [];
    const entries = listTar((offset, length) => {
      reads.push(length);
      return archive.subarray(offset, offset + length);
    }, archive.length);
    expect(entries.map((e) => [e.name, e.size])).toEqual(files.map((f) => [f.name, f.data.length]));
    for (const [i, e] of entries.entries()) expect(archive.subarray(e.offset, e.offset + e.size)).toEqual(files[i].data);
    expect(Math.max(...reads)).toBe(TAR_BLOCK);
  });

  it('rejects a damaged header', () => {
    const archive = buildTar([{ name: 'a.txt', data: bytes(10) }]);
    archive[3] ^= 1;
    expect(() => listTar(reader(archive), archive.length)).toThrow(/checksum/);
  });

  it('streams files in chunks, giving the same archive as building it in memory', async () => {
    const files = [
      { name: 'n/night.json', data: bytes(300) },
      { name: 'n/segment-001.m4a', data: bytes(2600, 5) },
    ];
    const opened: string[] = [];
    const open = (path: string): TarFileReader => {
      opened.push(path);
      const data = files.find((f) => f.name === path)!.data;
      let at = 0;
      return {
        read: (n) => data.subarray(at, (at = Math.min(data.length, at + n))),
        close: () => undefined,
      };
    };
    const out: Uint8Array[] = [];
    const progress: number[] = [];
    await writeTar(
      [
        { name: files[0].name, size: 300, data: files[0].data },
        { name: files[1].name, size: 2600, path: files[1].name },
      ],
      (b) => void out.push(b.slice()),
      { mtimeS: 7, open, chunkBytes: 1000, onProgress: (w) => void progress.push(w) },
    );
    const joined = new Uint8Array(out.reduce((n, b) => n + b.length, 0));
    out.reduce((at, b) => (joined.set(b, at), at + b.length), 0);
    expect(joined).toEqual(buildTar(files, 7));
    expect(opened).toEqual(['n/segment-001.m4a']);
    expect(progress[progress.length - 1]).toBe(joined.length);
  });

  it('fails when a file is not the size its header says', async () => {
    // A 100-byte file.
    const open = (): TarFileReader => {
      const data = bytes(100);
      let at = 0;
      return { read: (n) => data.subarray(at, (at = Math.min(data.length, at + n))), close: () => undefined };
    };
    await expect(writeTar([{ name: 'a', size: 200, path: 'a' }], () => undefined, { mtimeS: 0, open })).rejects.toThrow(/shorter/);
    await expect(writeTar([{ name: 'a', size: 50, path: 'a' }], () => undefined, { mtimeS: 0, open })).rejects.toThrow(/longer/);
  });
});
