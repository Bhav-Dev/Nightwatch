import { Directory, File, Paths } from 'expo-file-system';

import type { ClipFiles } from './clipFiles';

/** Clips live in the app's document directory (not backed up to any server). */
export class ExpoClipFiles implements ClipFiles {
  private dir = new Directory(Paths.document, 'clips');

  async write(name: string, bytes: Uint8Array) {
    if (!this.dir.exists) this.dir.create({ intermediates: true });
    const file = new File(this.dir, name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return { path: file.uri, bytes: bytes.length };
  }

  async read(path: string) {
    return new File(path).bytes();
  }

  async remove(path: string) {
    const f = new File(path);
    if (f.exists) f.delete();
  }
}
