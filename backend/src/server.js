import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './app.js';
import { ensureOpenBatch } from './services/batch.service.js';

const app = createApp();

async function main() {
  // Cria batch 1 se não existir
  await ensureOpenBatch(); 
  
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Raspe SOL API listening on port ${env.PORT}`);
  });
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
