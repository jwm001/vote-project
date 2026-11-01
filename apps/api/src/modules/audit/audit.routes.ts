import { Router } from 'express';
import { auditController } from './audit.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/votes/:voteId/audit/pdf', authMiddleware, auditController.getAuditPdf);

export default router;
