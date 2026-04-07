import pool from "../../config/db.js"; // your pg pool

// CREATE
export const createTutorialService = async ({ title, url }) => {
  const query = `
    INSERT INTO tutorials (title, url)
    VALUES ($1, $2)
    RETURNING *;
  `;
  const values = [title, url];

  const { rows } = await pool.query(query, values);
  return rows[0];
};

// GET ALL
export const getAllTutorialsService = async () => {
  const { rows } = await pool.query(
    "SELECT * FROM tutorials ORDER BY created_at DESC"
  );
  return rows;
};

// DELETE
export const deleteTutorialService = async (id) => {
  const { rowCount } = await pool.query(
    "DELETE FROM tutorials WHERE id = $1",
    [id]
  );

  if (rowCount === 0) {
    throw new Error("Tutorial not found");
  }

  return { message: "Tutorial deleted successfully" };
};