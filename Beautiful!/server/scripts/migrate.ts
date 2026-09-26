import { openDatabase } from "../db/database.ts";

const database = await openDatabase();
console.log(`e Gain database migrations complete (${database.mode}).`);
await database.close();
