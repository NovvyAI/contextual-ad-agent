import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ matchSessionId: z.number() }),
  async (req, res) => {
    const { matchSessionId } = req.body;
    const row = await u.db("ab_matchSession").where("id", matchSessionId).first();
    if (!row) return res.status(400).send(error(`匹配创作会话 ${matchSessionId} 不存在`));

    await u.db("ab_matchSession").where("id", matchSessionId).delete();
    return res.status(200).send(success({ id: matchSessionId }));
  },
);
