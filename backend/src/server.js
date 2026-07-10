import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './app.js';
import { ensureOpenBatch } from './services/batch.service.js';

const app = createApp();
let server;

async function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando aplicação...`);

  try {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }

    await prisma.$disconnect();
    console.log('Prisma desconectado.');
  } catch (err) {
    console.error('Erro durante o encerramento:', err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  console.log('Inicializando Raspe SOL API...');

  await ensureOpenBatch();

  server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 Raspe SOL API rodando em http://0.0.0.0:${env.PORT}`);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  await shutdown('uncaughtException');
});

main().catch(async (err) => {
  console.error('Falha ao iniciar a API:', err);

  try {
    await prisma.$disconnect();
  } finally {
    process.exit(1);
  }
});
