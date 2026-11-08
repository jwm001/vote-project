import { Response } from "express";
import { auditService } from "./audit.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { messageOf, statusCodeOf } from "../../utils/errors";

export const auditController = {
  async getAuditPdf(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { voteId } = req.params;
      const result = await auditService.generateAuditPdf(voteId, {
        id: user.id,
        role: user.role,
        status: user.status,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-${voteId}.pdf"`
      );
      res.setHeader("X-Audit-Digest", result.digest);
      res.setHeader("X-Audit-Integrity", result.integrity);
      res.setHeader("X-Audit-Redacted", String(result.redacted));
      if (result.recordedDigest) {
        res.setHeader("X-Audit-Sealed-Digest", result.recordedDigest);
      }
      res.send(result.pdf);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  },
};
