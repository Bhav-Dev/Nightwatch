import { File, FileMode, Paths } from 'expo-file-system';

import type { Db } from '../data/db';
import { LABELLING_EXPORT_FORMAT, type LabellingExportPlan, planLabellingExport } from '../data/labellingExport';
import { writeTar } from '../data/tar';

/** Room to leave free on the phone after writing the archive. */
const SPARE_BYTES = 100_000_000;

/** A sound file's size on this phone, or null when it is missing. */
function fileSize(uri: string): number | null {
  const f = new File(uri);
  return f.exists ? f.size : null;
}

/** Plans an export of the last `count` nights with sound (see src/data/labellingExport.ts). */
export function planLabellingArchive(db: Db, count: number): Promise<LabellingExportPlan | null> {
  return planLabellingExport(db, { count, fileSize });
}

/** Earlier archives in the cache: they can be hundreds of MB, so only the latest is kept. */
function deleteOldArchives(): void {
  for (const item of Paths.cache.list()) {
    if (item instanceof File && item.name.startsWith(`${LABELLING_EXPORT_FORMAT}-`) && item.name.endsWith('.tar')) item.delete();
  }
}

/**
 * Writes the planned archive to the cache directory, copying the sound files in 1 MB chunks and
 * yielding between them so the screen can show progress. Returns the archive's URI for sharing.
 */
export async function writeLabellingArchive(plan: LabellingExportPlan, onProgress?: (fraction: number) => void): Promise<string> {
  deleteOldArchives();
  if (Paths.availableDiskSpace < plan.totalBytes + SPARE_BYTES) {
    throw new Error(`The export needs ${Math.ceil((plan.totalBytes + SPARE_BYTES) / 1_000_000)} MB free on this phone. Free some space, or export fewer nights.`);
  }
  const file = new File(Paths.cache, plan.fileName);
  file.create({ overwrite: true });
  const out = file.open(FileMode.Truncate);
  let written = false;
  try {
    await writeTar(plan.inputs, (bytes) => out.writeBytes(bytes), {
      mtimeS: Math.floor(Date.now() / 1000),
      open: (path) => {
        const handle = new File(path).open(FileMode.ReadOnly);
        return { read: (n) => handle.readBytes(n), close: () => handle.close() };
      },
      onProgress: async (written, total) => {
        onProgress?.(written / total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    written = true;
  } finally {
    out.close();
    if (!written && file.exists) file.delete();
  }
  return file.uri;
}
