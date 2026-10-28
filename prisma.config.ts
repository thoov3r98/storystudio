import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations use Neon's direct (non-pooled) connection when provided.
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
