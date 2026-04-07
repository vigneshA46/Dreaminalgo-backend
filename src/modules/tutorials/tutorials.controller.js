import * as tutorialsService from "./tutorials.service.js";

// CREATE
export const createTutorial = async (req, res) => {
  try {
    const result = await tutorialsService.createTutorialService(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET ALL
export const getAllTutorials = async (req, res) => {
  try {
    const result = await tutorialsService.getAllTutorialsService();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE
export const deleteTutorial = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tutorialsService.deleteTutorialService(id);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};