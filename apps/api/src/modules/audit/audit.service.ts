import { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const prisma = new PrismaClient();

export const auditService = {
  async generateAuditPdf(voteId: string): Promise<Buffer> {
    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
      include: { options: true, ballots: true }
    });

    if (!vote) {
      throw new Error('Vote not found');
    }

    // Sort by sequence number
    const sortedBallots = [...vote.ballots].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;

    let y = height - 50;

    const clean = (text: string) => String(text).replace(/[^\x20-\x7E]/g, '?');

    page.drawText(clean(`Vote: ${vote.title}`), { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(clean(`Creator: ${vote.creatorId}`), { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(clean(`Start: ${vote.startAt.toISOString()}`), { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(clean(`End: ${vote.endAt.toISOString()}`), { x: 50, y, size: fontSize, font });
    y -= 30;

    page.drawText('Options:', { x: 50, y, size: fontSize, font });
    y -= 15;
    for (const option of vote.options) {
      page.drawText(clean(`  ${option.order + 1}. ${option.text}`), { x: 50, y, size: fontSize, font });
      y -= 15;
    }
    y -= 20;

    // 投票总结
    y -= 10;
    page.drawText('Summary:', { x: 50, y, size: fontSize, font });
    y -= 15;
    const totalVotes = sortedBallots.length;
    page.drawText(clean(`Total votes: ${totalVotes}`), { x: 50, y, size: fontSize, font });
    y -= 15;
    const optionCounts: Record<string, number> = {};
    vote.options.forEach((opt: any) => { optionCounts[opt.id] = 0; });
    for (const ballot of sortedBallots) {
      let optionIds: string[] = [];
      try {
        optionIds = JSON.parse(ballot.optionIds as any);
      } catch {
        optionIds = Array.isArray(ballot.optionIds) ? ballot.optionIds : [];
      }
      optionIds.forEach((id: string) => {
        if (optionCounts[id] !== undefined) optionCounts[id]++;
      });
    }
    for (const option of vote.options) {
      page.drawText(clean(`  ${option.text}: ${optionCounts[option.id] || 0} votes`), { x: 50, y, size: fontSize, font });
      y -= 12;
    }
    y -= 20;

    page.drawText('Records:', { x: 50, y, size: fontSize, font });
    y -= 15;
    page.drawText('Seq | Pseudonym | Time | Options', { x: 50, y, size: fontSize, font });
    y -= 15;

    for (const ballot of sortedBallots) {
      if (y < 50) {
        const newPage = pdfDoc.addPage();
        y = newPage.getSize().height - 50;
      }
      let optionIds: string[] = [];
      try {
        optionIds = JSON.parse(ballot.optionIds as any);
      } catch {
        optionIds = Array.isArray(ballot.optionIds) ? ballot.optionIds : [];
      }
      const optionTexts = optionIds
        .map((id: string) => {
          const opt = vote.options.find((o: any) => o.id === id);
          return opt ? opt.text : id;
        })
        .join(', ');
      const line = `${ballot.sequenceNumber} | ${ballot.pseudonym} | ${ballot.submittedAt.toISOString()} | ${optionTexts}`;
      page.drawText(clean(line).substring(0, 90), { x: 50, y, size: 8, font });
      y -= 12;
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
};
