import { Router } from "express";
import { getIO } from "./socketServer.js";

const router = Router();

router.post("/telemetry", (req, res) => {
  const data = req.body;

  const io = getIO();

  // ✅ BROADCAST TO EVERYONE
  io.emit("strategy_update", data);

  res.json({ success: true });
});

export default router;