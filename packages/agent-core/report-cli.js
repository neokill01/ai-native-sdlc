import { accessSync, constants } from 'node:fs';
import { TaskStore } from './index.js';

let store;
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--db' || !['--task', '--report'].includes(args[2]) || !args[1] || !args[3]) {
    throw new Error('Usage: npm run report -- --db FILE (--task TASK_ID | --report REPORT_ID)');
  }
  // Refuse to create an empty database due to an operator typo.
  accessSync(args[1], constants.R_OK | constants.W_OK);
  store = new TaskStore(args[1]);
  console.log(JSON.stringify(args[2] === '--task' ? store.report(args[3]) : store.readReport(args[3]), null, 2));
} catch (error) {
  console.error(error.message.startsWith('Usage:') ? error.message : 'Unable to read report: check database and identifier.');
  process.exitCode = 1;
} finally { store?.close(); }
