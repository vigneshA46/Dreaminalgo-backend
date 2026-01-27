import pool from '../../config/db.js';

/* Get own profile */
export const getMe = async (userId) => {
  const { rows } = await pool.query(
    'SELECT id, email, fullname, role, isactive, createdat FROM users WHERE id = $1',
    [userId]
  );
  return rows[0];
};

/* Update own profile */
export const updateMe = async (userId, data) => {
  const { fullname } = data;

  const { rows } = await pool.query(
    `UPDATE users
     SET fullname = COALESCE($1, fullname),
         updatedat = NOW()
     WHERE id = $2
     RETURNING id, email, fullname, role`,
    [fullname, userId]
  );

  return rows[0];
};

/* Admin: get all users */
export const getAllUsers = async () => {
  const { rows } = await pool.query(
    'SELECT id, email, fullname, role, isactive, createdat FROM users ORDER BY createdat DESC'
  );
  return rows;
};

/* Admin: get single user */
export const getUserById = async (id) => {
  const { rows } = await pool.query(
    'SELECT id, email, fullname, role, isactive FROM users WHERE id = $1',
    [id]
  );
  return rows[0];
};

/* Admin: update user */
export const updateUser = async (id, data) => {
  const { fullname, isactive } = data;

  const { rows } = await pool.query(
    `UPDATE users
     SET fullname = COALESCE($1, fullname),
         isactive = COALESCE($2, isactive),
         updatedat = NOW()
     WHERE id = $3
     RETURNING id, email, fullname, role, isactive`,
    [fullname, isactive, id]
  );

  return rows[0];
};

/* Admin: soft delete */
export const deleteUser = async (id) => {
  await pool.query(
    'UPDATE users SET isactive = false, updatedat = NOW() WHERE id = $1',
    [id]
  );
};
