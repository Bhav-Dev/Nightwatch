/** Where clip bytes live. The app uses the document directory; tests use memory. */
export interface ClipFiles {
  write(name: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export class MemoryClipFiles implements ClipFiles {
  readonly files = new Map<string, Uint8Array>();
  async write(name: string, bytes: Uint8Array) {
    const path = `mem://clips/${name}`;
    this.files.set(path, bytes);
    return { path, bytes: bytes.length };
  }
  async read(path: string) {
    const b = this.files.get(path);
    if (!b) throw new Error(`missing ${path}`);
    return b;
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}
