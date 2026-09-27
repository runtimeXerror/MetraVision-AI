import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import net from 'node:net';
import os from 'node:os';

import { createApp } from './app';
import { connectDatabase, disconnectDatabase, isEphemeralDatabase } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { seedDatabase } from './seed/seed';
import { migrateReviewStates } from './services/migrateReviewStates';

/**
 * Server entry point.
 *
 * Order matters: the database must be connected and (when empty) seeded before
 * the port opens, so a mobile client can never reach an API backed by a
 * half-initialised database.
 */

async function bootstrap(): Promise<void> {
  await fs.mkdir(env.uploadPath, { recursive: true });

  // Before the database, deliberately.
  //
  // `tsx watch` starts the replacement process before the outgoing one has
  // exited, so on a restart both are briefly alive. Connecting first meant the
  // newcomer found the data directory locked, killed the mongod holding it —
  // which belonged to the process still serving traffic — and only then
  // discovered the port was taken and exited. The incumbent survived with its
  // database pulled out from under it, which is what "the backend is up but
  // every request fails" actually was.
  //
  // Claiming the port first inverts that: if another process holds it, this one
  // leaves without touching anything the incumbent depends on.
  await assertPortAvailable(env.PORT);

  await connectDatabase();

  if (env.AUTO_SEED) {
    const result = await seedDatabase({ onlyIfEmpty: true });
    if (result.seeded) {
      logger.info(`Seeded ${result.users} users and ${result.inspections} inspections.`);
    }
  }

  // Records left in the retired "review required" state, or evaluated under an
  // older engine, are re-run before the first request can read them.
  await migrateReviewStates();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api`);

    // A device on the LAN cannot reach `localhost`, so print the address the
    // mobile app should actually be pointed at.
    for (const address of lanAddresses()) {
      logger.info(`  reachable from a device at http://${address}:${env.PORT}/api`);
    }

    if (isEphemeralDatabase()) {
      logger.warn(
        'Using the development database — it survives a restart but lives in a temporary ' +
          'directory. Set MONGODB_URI for a durable one.',
      );
    }
  });

  // A port already held by a previous run is the single most common way this
  // server fails to start, and as an uncaught exception it arrives as a stack
  // trace that says nothing about what to do. Worse, the process still holding
  // the port goes on answering — including health checks — while its database
  // has been replaced underneath it, so the system looks up but every request
  // fails. Name it and say how to clear it.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal(
        `Port ${env.PORT} is already in use — most likely a previous backend that ` +
          'was force-killed and left its process running.',
      );
      logger.fatal(
        process.platform === 'win32'
          ? `Find it with:  netstat -ano | findstr :${env.PORT}    then:  taskkill /PID <pid> /F`
          : `Find it with:  lsof -i :${env.PORT}    then:  kill -9 <pid>`,
      );
      process.exit(1);
    }

    logger.fatal({ err: error }, 'Server error');
    process.exit(1);
  });

  installShutdownHandlers(server);
}

/**
 * Exits unless the port is free, before any shared resource is touched.
 */
async function assertPortAvailable(port: number): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const probe = net
      .createServer()
      .once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRINUSE'))
      .once('listening', () => probe.close(() => resolve(false)))
      .listen(port);
  });

  if (!inUse) return;

  logger.fatal(
    `Port ${port} is already in use — most likely a previous backend that was ` +
      'force-killed and left its process running.',
  );
  logger.fatal(
    process.platform === 'win32'
      ? `Find it with:  netstat -ano | findstr :${port}    then:  taskkill /PID <pid> /F`
      : `Find it with:  lsof -i :${port}    then:  kill -9 <pid>`,
  );
  process.exit(1);
}

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info): info is NonNullable<typeof info> => Boolean(info))
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
}

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received — shutting down.`);
    server.close();
    await disconnectDatabase().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    // An uncaught exception leaves the process in an unknown state; log and
    // exit rather than continuing to serve requests from it.
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
