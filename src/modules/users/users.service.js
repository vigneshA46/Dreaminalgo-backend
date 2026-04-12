import pool from '../../config/db.js';
import bcrypt from 'bcrypt';


/* Get own profile */
export const getMe = async (userId) => {
  const { rows } = await pool.query(
    'SELECT id, email, fullname, role, isactive, createdat, tokens FROM users WHERE id = $1',
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
    `SELECT id, email, fullname, role, isactive, createdat, tokens, mobile_number, passwordhash
     FROM users 
     ORDER BY createdat DESC`
  );
  return rows;
};

/* Admin: get single user */
export const getUserById = async (id) => {
  const { rows } = await pool.query(
    'SELECT id, email, fullname, role, isactive, tokens , mobile_number FROM users WHERE id = $1',
    [id]
  );
  return rows[0];
};


/* Admin: update user */
export const updateUser = async (id, data) => {
  const { fullname, isactive, mobile_number, tokens, password } = data;

  const parsedTokens = Number(tokens);

  let hashedPassword = null;

  if (password) {
    const saltRounds = 10;
    hashedPassword = await bcrypt.hash(password, saltRounds);
  }

  const { rows } = await pool.query(
    `UPDATE users
     SET fullname = COALESCE($1, fullname),
         isactive = COALESCE($2, isactive),
         mobile_number = COALESCE($3, mobile_number),
         tokens = COALESCE($4, tokens),
         passwordhash = COALESCE($5, passwordhash),
         updatedat = NOW()
     WHERE id = $6
     RETURNING id, email, fullname, role, isactive, mobile_number, tokens`,
    [fullname, isactive, mobile_number, parsedTokens, hashedPassword, id]
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
