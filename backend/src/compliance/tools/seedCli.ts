import { logger } from '../../config/logger';
import { invalidateCorpusCache, ruleSetValidationReport } from '../ruleEngineService';
import { seedLegalCorpus } from '../seed';

/**
 * Seeds the legal corpus and validates it.
 *
 *   npm run rules:seed          seed, then report
 *   npm run rules:seed -- --reset   clear the collections first
 *
 * Validation runs after seeding rather than before, deliberately: what matters
 * is whether the corpus is sound *as it now sits in the database*, which is not
 * the same question as whether the source files are sound. A projection can
 * lose something the source had.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const { connectDatabase, disconnectDatabase, isEphemeralDatabase } = await import('../../config/db');

  await connectDatabase();

  if (isEphemeralDatabase()) {
    logger.error('No MONGODB_URI is set, so this would seed a throwaway in-memory database.');
    await disconnectDatabase();
    process.exit(1);
  }

  const result = await seedLegalCorpus({ reset });
  invalidateCorpusCache();

  logger.info(
    `Seeded ${result.amendments} amendments, ${result.ruleVersions} rule versions, ` +
      `${result.exceptions} exemptions and ${result.sourceConflicts} recorded source conflicts.`,
  );

  const report = await ruleSetValidationReport();
  logger.info(`Rule set ${report.ruleSetVersion} (${report.ruleSetChecksum}) — ${report.valid ? 'valid' : 'INVALID'}.`);
  logger.info(`${report.counts.errors} errors, ${report.counts.warnings} warnings, ${report.counts.info} info.`);

  for (const conflict of report.conflicts.filter((entry) => entry.severity === 'ERROR')) {
    logger.error(`${conflict.code}: ${conflict.message}`);
  }

  await disconnectDatabase();
  // A corpus with structural errors must not be deployed silently.
  process.exit(report.valid ? 0 : 1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(error);
    process.exit(1);
  });
}
