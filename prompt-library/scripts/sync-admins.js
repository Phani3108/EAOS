#!/usr/bin/env node
/**
 * sync-admins.js
 *
 * Reads config/admins.json and ensures all listed emails have the ADMIN role.
 * Users NOT in the list are left unchanged (no automatic demotion).
 *
 * Usage (inside container):
 *   node /app/scripts/sync-admins.js
 *
 * Usage (via make):
 *   make compose-sync-admins  # applies against compose container
 */

"use strict";

const { PrismaClient } = require(".prisma/client");
const fs = require("fs");
const path = require("path");

const db = new PrismaClient();

async function main() {
  const configPath = path.join(__dirname, "..", "config", "admins.json");

  if (!fs.existsSync(configPath)) {
    console.error("ERROR: config/admins.json not found at", configPath);
    process.exit(1);
  }

  const { admins } = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!Array.isArray(admins) || admins.length === 0) {
    console.log("No admins listed in config/admins.json — nothing to do.");
    return;
  }

  console.log(`\nSyncing ${admins.length} admin(s) from config/admins.json...\n`);

  for (const email of admins) {
    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      console.log(`  SKIP  ${email} — not found in database (user must log in first)`);
      continue;
    }

    if (user.role === "ADMIN") {
      console.log(`  OK    ${email} — already ADMIN`);
      continue;
    }

    await db.user.update({ where: { email }, data: { role: "ADMIN" } });
    console.log(`  PROMOTED  ${email}  USER → ADMIN`);
  }

  console.log("\nDone.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
