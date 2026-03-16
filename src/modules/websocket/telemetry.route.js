import { Router } from "express";
import { getIO } from "./socketServer.js";

const router = Router();

router.post("/telemetry", (req, res) => {

  const data = req.body;

  const io = getIO();

  const runId = data.run_id;

  io.to(runId).emit("strategy_update", data);

  res.json({ success: true });

});

export default router;