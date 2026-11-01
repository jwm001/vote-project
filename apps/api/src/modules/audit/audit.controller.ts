import { Request, Response } from 'express';
import { auditService } from './audit.service';

export const auditController = {
  async getAuditPdf(req: Request, res: Response) {
    try {
      const { voteId } = req.params;
      const pdfBuffer = await auditService.generateAuditPdf(voteId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${voteId}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
