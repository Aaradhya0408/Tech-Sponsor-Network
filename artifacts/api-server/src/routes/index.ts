import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import creatorProfilesRouter from "./creator-profiles";
import adminCampaignsRouter from "./admin-campaigns";
import creatorCampaignsRouter from "./creator-campaigns";
import creatorApplicationsRouter from "./creator-applications";
import adminApplicationsRouter from "./admin-applications";
import invoicesRouter from "./invoices";
import adminEmailRouter from "./admin-email";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(creatorProfilesRouter);
router.use(adminCampaignsRouter);
router.use(creatorCampaignsRouter);
router.use(creatorApplicationsRouter);
router.use(adminApplicationsRouter);
router.use(invoicesRouter);
router.use(adminEmailRouter);

export default router;
