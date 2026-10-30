import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import creatorProfilesRouter from "./creator-profiles";
import adminCampaignsRouter from "./admin-campaigns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(creatorProfilesRouter);
router.use(adminCampaignsRouter);

export default router;
