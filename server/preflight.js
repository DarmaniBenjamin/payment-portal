// Imported first by index.js, so a bad setup is reported clearly before anything else loads.
import { checkConfig } from './config.js';

const problems = checkConfig();
if (problems.length) {
  console.error('The payment service cannot start. Fix these settings (in .env, or in SiteGround’s environment variables):');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
