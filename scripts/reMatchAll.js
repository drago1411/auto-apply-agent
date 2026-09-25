import { initDb } from '../tracker/db.js';
import { runMatcher } from '../matcher/matcherService.js';
import { printCliOverview } from '../tracker/cli.js';

const db = initDb();
db.exec("UPDATE jobs SET status = 'new' WHERE status != 'applied'");

await runMatcher();
printCliOverview();
