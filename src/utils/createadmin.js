import pkg from "pg";
const { Pool } = pkg;
import bcrypt from 'bcrypt'
// ==============================
// Database Connection
// ==============================
const pool = new Pool({
  connectionString: `postgresql://postgres:KhUMkVkuZEHdijNRrCODSmaWNAWSjjzB@shinkansen.proxy.rlwy.net:59168/railway`,
  ssl: {
    rejectUnauthorized: false
  }
});

// ==============================
// Create Admin Function
// ==============================
async function createAdmin() {
  try {
    const admincode = "ROOT001";
    const name = "Super Admin";
    const email = "adminm@gmail.com";
    const password = "123456";
    const role = "superadmin";

    //  Hash Password
    const saltRounds = 12;
    const passwordhash = await bcrypt.hash(password, saltRounds);

    //  Insert Query
    const query = `
      INSERT INTO admins 
      (admincode, name, email, passwordhash, role, isactive)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, admincode, email, role;
    `;

    const values = [
      admincode,
      name,
      email,
      passwordhash,
      role,
      true
    ];

    const result = await pool.query(query, values);

    console.log("✅ Admin created successfully:");
    console.log(result.rows[0]);

  } catch (error) {
    console.error("❌ Error creating admin:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

createAdmin();
