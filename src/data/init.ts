import { seedCatalogueIfEmpty } from './catalogueRepo';
import type { Db } from './db';
import { migrate } from './schema';

/** Runs once when the app opens the database: schema migrations, then the bundled catalogue. */
export async function initDatabase(db: Db): Promise<void> {
  await migrate(db);
  await seedCatalogueIfEmpty(db);
}
