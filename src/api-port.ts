import { z } from 'zod';

export function apiPort() {
  const value = process.env.MIGRATEPROOF_API_PORT ?? '4300';
  return z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(1024).max(65535)).parse(value);
}
