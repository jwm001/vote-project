import { prisma } from "../../utils/prisma";

function generatePseudonym() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `user_${timestamp}_${random}`;
}

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

  async submitVote(data: { userId: string; voteId: string; optionIds: string[] }) {
    const vote = await prisma.vote.findUnique({
      where: { id: data.voteId },
      include: { options: true },
    });

    if (!vote) {
      throw new Error("Vote not found");
    }

    // Check if user has already voted
    const existingHistory = await prisma.userVoteHistory.findUnique({
      where: {
        userId_voteId: {
          userId: data.userId,
          voteId: data.voteId,
        },
      },
    });

    if (existingHistory) {
      throw new Error("Already voted");
    }

    // Get the next sequence number for this vote
    const lastBallot = await prisma.ballot.findFirst({
      where: { voteId: data.voteId },
      orderBy: { sequenceNumber: "desc" },
    });
    const sequenceNumber = lastBallot ? lastBallot.sequenceNumber + 1 : 1;

    const pseudonym = generatePseudonym();

    // Create ballot and user vote history in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const ballot = await tx.ballot.create({
        data: {
          voteId: data.voteId,
          pseudonym,
          optionIds: JSON.stringify(data.optionIds),
          sequenceNumber,
        },
      });

      await tx.userVoteHistory.create({
        data: {
          userId: data.userId,
          voteId: data.voteId,
        },
      });

      return ballot;
    });

    return result;
  }
}
