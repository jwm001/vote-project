import { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;

    let y = height - 50;

    page.drawText(`投票场名称: ${vote.title}`, { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(`创建者: ${vote.creatorId}`, { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(`开始时间: ${vote.startAt.toISOString()}`, { x: 50, y, size: fontSize, font });
    y -= 20;
    page.drawText(`结束时间: ${vote.endAt.toISOString()}`, { x: 50, y, size: fontSize, font });
    y -= 30;

    page.drawText('选项列表:', { x: 50, y, size: fontSize, font });
    y -= 15;
    for (const option of vote.options) {
      page.drawText(`  ${option.order}. ${option.text}`, { x: 50, y, size: fontSize, font });
      y -= 15;
    }
    y -= 20;

    page.drawText('投票记录:', { x: 50, y, size: fontSize, font });
    y -= 15;
    page.drawText('序号 | 假名 | 投票时间 | 选项', { x: 50, y, size: fontSize, font });
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
        .map((id: string) => vote.options.find((o: any) => o.id === id)?.text || id)
        .join(', ');
      const line = `${ballot.sequenceNumber} | ${ballot.pseudonym} | ${ballot.submittedAt.toISOString()} | ${optionTexts}`;
      page.drawText(line.substring(0, 80), { x: 50, y, size: 8, font });
      y -= 12;
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
};
