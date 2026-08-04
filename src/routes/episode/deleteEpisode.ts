import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ episodeId: z.number() }),
  async (req, res) => {
    const { episodeId } = req.body;
    const episode = await u.db("ab_episode").where("id", episodeId).first();
    if (!episode) return res.status(400).send(error("Episode 不存在"));

    // 只删数据库记录，不动 sourceFilePath 指向的原始文件——那是用户机器上的文件，不归这个 App 管
    const planRows = await u.db("ab_creativePlan").where("episodeId", episodeId).select("id");
    const planIds = planRows.map((p: any) => p.id);

    if (planIds.length > 0) {
      const cutRows = await u.db("ab_bridgeCut").whereIn("creativePlanId", planIds).select("id");
      const cutIds = cutRows.map((c: any) => c.id);
      if (cutIds.length > 0) {
        await u.db("ab_generatedSegment").whereIn("bridgeCutId", cutIds).delete();
        await u.db("ab_bridgeCut").whereIn("id", cutIds).delete();
      }
      await u.db("ab_manifest").whereIn("creativePlanId", planIds).delete();
      await u.db("ab_creativePlan").whereIn("id", planIds).delete();
    }
    await u.db("ab_manifest").where("episodeId", episodeId).delete();
    await u.db("ab_chatEvent").where("episodeId", episodeId).delete();
    await u.db("ab_episode").where("id", episodeId).delete();

    return res.status(200).send(success({ id: episodeId }));
  },
);
