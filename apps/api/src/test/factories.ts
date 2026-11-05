import { prisma } from "../utils/prisma";

export function makeUser(username = "alice", status = "APPROVED") {
  return prisma.user.create({
    data: {
      username,
      password: "x",
      realName: "enc",
      status,
      idNumberHash: `hash-${username}`,
    },
  });
}
