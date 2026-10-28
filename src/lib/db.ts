import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma client shared by the Next.js app and Trigger.dev tasks.
 * Neon hosts use the Neon serverless driver; any other Postgres (local dev,
 * CI) uses node-postgres.
 */
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. See README \"Environment variables\".");
  }
  const isNeon = /\.neon\.tech|\.neon\.build/.test(connectionString);
  // DATABASE_POOL_MAX=1 is needed for single-connection local servers such as `prisma dev`.
  const max = process.env.DATABASE_POOL_MAX ? Number(process.env.DATABASE_POOL_MAX) : undefined;
  const adapter = isNeon ? new PrismaNeon({ connectionString, max }) : new PrismaPg({ connectionString, max });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // Lazily construct so importing this module never requires DATABASE_URL (e.g. during build).
    globalForPrisma.prisma ??= createClient();
    const value = Reflect.get(globalForPrisma.prisma, prop);
    return typeof value === "function" ? value.bind(globalForPrisma.prisma) : value;
  },
});

export type { PrismaClient };
