import bcrypt from 'bcrypt';
import pool from '../../config/db.js';

const createAdminService = async (data, creatorId) => {
  const { name, email, password, role } = data;

  if (!['superadmin', 'courseadmin'].includes(role)) {
    throw new Error('Invalid admin role');
  }

  const hash = await bcrypt.hash(password, 12);

  const { rows } = await pool.query(
    `
    INSERT INTO admins (name, email, passwordhash, role, createdby)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, createdat
    `,
    [name, email, hash, role, creatorId]
  );

  return rows[0];
};
 
export default createAdminService
 