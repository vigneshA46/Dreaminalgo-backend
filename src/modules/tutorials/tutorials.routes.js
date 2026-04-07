import express from "express";
import {
  createTutorial,
  getAllTutorials,
  deleteTutorial,
} from "./tutorials.controller.js";

const router = express.Router();

// CREATE
router.post("/", createTutorial);

// GET ALL
router.get("/", getAllTutorials);

// DELETE
router.delete("/:id", deleteTutorial);

export default router;