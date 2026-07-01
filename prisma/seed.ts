import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const users = [
    { username: "Abhay", password: "IITGN1" },
    { username: "Rahulpatel", password: "IITGN4" },
    { username: "DhruvIT", password: "IITGN2" },
    { username: "Sagar", password: "IITGN8" },
    { username: "Rishabh", password: "IITGN9" },
    { username: "Faizan", password: "IITGN5" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { passwordHash: await bcrypt.hash(u.password, 12), displayName: u.username },
      create: { username: u.username, passwordHash: await bcrypt.hash(u.password, 12), displayName: u.username },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
