/**
 * Database Configuration
 * Prisma client initialization with PostgreSQL
 */
import { PrismaClient } from "@prisma/client";

console.log("[DB] Connecting to PostgreSQL");

export const prisma = new PrismaClient();
