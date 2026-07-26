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
    `SELECT id, email, fullname, role, isactive, createdat, tokens, mobile_number, passwordhash , status, remarks
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
  console.log(data)
  const {
    fullname,
    isactive,
    mobile_number,
    tokens,
    password,
    remarks,
    status,
  } = data;

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
         remarks = COALESCE($6, remarks),
         status = COALESCE($7, status),
         updatedat = NOW()
     WHERE id = $8
     RETURNING
       id,
       email,
       fullname,
       role,
       isactive,
       mobile_number,
       tokens,
       remarks,
       status`,
    [
      fullname,
      isactive,
      mobile_number,
      parsedTokens,
      hashedPassword,
      remarks,
      status,
      id,
    ]
  );
  console.log(rows[0]);

  return rows[0];
};
/* Admin: soft delete */
/* Admin: permanently delete user */
export const deleteUser = async (id) => {
  const { rows } = await pool.query(
    `DELETE FROM users
     WHERE id = $1
     RETURNING id, email, fullname`,
    [id]
  );

  return rows[0];
};


/* Admin: get users with low tokens */
export const getUsersWithLowTokens = async () => {
  const { rows } = await pool.query(
    `SELECT
       id,
       email,
       fullname,
       role,
       isactive,
       createdat,
       tokens,
       mobile_number,
       status,
       remarks
     FROM users
     WHERE tokens < 5
     ORDER BY tokens ASC, createdat DESC`
  );

  return rows;
};