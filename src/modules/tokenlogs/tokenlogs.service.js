import pool from '../../config/db.js';


/* Get all token logs */
export const getAllTokenLogs = async (filters = {}) => {

  const {
    search,
    user_id,
    from_date,
    to_date,
  } = filters;

  let query = `
    SELECT
      tl.id,
      tl.user_id,
      tl.previous_tokens,
      tl.updated_tokens,
      tl.notes,
      tl.createdat,

      u.fullname,
      u.email,
      u.mobile_number

    FROM tokenlogs tl

    INNER JOIN users u
      ON tl.user_id = u.id

    WHERE 1 = 1
  `;

  const values = [];
  let index = 1;


  /* User search */
  if (search) {
    query += `
      AND (
        u.fullname ILIKE $${index}
        OR u.email ILIKE $${index}
        OR u.mobile_number ILIKE $${index}
      )
    `;

    values.push(`%${search}%`);
    index++;
  }


  /* Specific user filter */
  if (user_id) {
    query += `
      AND tl.user_id = $${index}
    `;

    values.push(user_id);
    index++;
  }


  /* From date */
  if (from_date) {
    query += `
      AND tl.createdat >= $${index}
    `;

    values.push(from_date);
    index++;
  }


  /* To date */
  if (to_date) {
    query += `
      AND tl.createdat < ($${index}::date + INTERVAL '1 day')
    `;

    values.push(to_date);
    index++;
  }


  query += `
    ORDER BY tl.createdat DESC
  `;


  const { rows } = await pool.query(query, values);

  return rows;
};