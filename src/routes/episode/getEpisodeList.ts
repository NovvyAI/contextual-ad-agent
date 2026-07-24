import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const list = await u.db("ab_episode").select("id", "title", "status", "durationMs", "createTime").orderBy("createTime", "desc");
  return res.status(200).send(success(list));
});
