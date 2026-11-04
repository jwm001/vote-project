import { prisma } from "../utils/prisma";

export async function resetDb() {
  await prisma.userVoteHistory.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.option.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.user.deleteMany();
}
