import { prisma } from "../../utils/prisma";

export class VoteService {
  async createVote(data: {
    creatorId: string;
    title: string;
    description?: string;
    allowMultiple: boolean;
    startAt: Date;
    endAt: Date;
    options: string[];
  }) {
    const vote = await prisma.vote.create({
      data: {
        title: data.title,
        description: data.description,
        creatorId: data.creatorId,
        allowMultiple: data.allowMultiple,
        startAt: data.startAt,
        endAt: data.endAt,
        options: {
          create: data.options.map((text, index) => ({
            text,
            order: index,
          })),
        },
      },
      include: {
        options: true,
      },
    });
    return vote;
  }

  async getVotes() {
    const votes = await prisma.vote.findMany({
      include: {
        options: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return votes;
  }

  async getVoteById(id: string) {
    const vote = await prisma.vote.findUnique({
      where: { id },
      include: {
        options: true,
      },
    });
    return vote;
  }
}
