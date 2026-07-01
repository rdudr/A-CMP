import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node scripts/upsert-user.mjs <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: "ADMIN",
      name: "Risha Admin",
    },
    create: {
      email,
      passwordHash,
      role: "ADMIN",
      name: "Risha Admin",
    },
  });
  console.log(`User ready: ${email}`);
} finally {
  await prisma.$disconnect();
}
