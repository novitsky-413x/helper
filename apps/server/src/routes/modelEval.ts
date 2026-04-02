import { Router } from "express";
import { getModelRankings } from "../services/modelEval.js";

const router = Router();

router.get("/rankings", (_req, res) => {
  const rankings = getModelRankings();
  res.json({ rankings });
});

export default router;
