import { defaultDatabasePath, openDatabase } from './database';

const path = process.env.DATABASE_PATH ?? defaultDatabasePath;
const db = openDatabase(path);
db.close();
console.log(`Database migrations applied: ${path}`);
