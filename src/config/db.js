import pkg from "pg";
const { Pool } = pkg;
import bcrypt from 'bcrypt'


const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD), 
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
});

export const initDB = async () => {


  try {
    // Enable UUID extension
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    /* USERS */
   await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    passwordhash TEXT,
    fullname VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    isactive BOOLEAN DEFAULT true,
    auth_provider VARCHAR(20) NOT NULL DEFAULT 'local',
    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);


    /* REFRESH TOKEN */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refreshtoken (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        userid UUID REFERENCES users(id) ON DELETE CASCADE,
        tokenhash TEXT NOT NULL,
        expiresat TIMESTAMP NOT NULL,
        revokedat TIMESTAMP,
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    /* ADMINS */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        admincode VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        passwordhash TEXT NOT NULL,
        role VARCHAR(50),
        isactive BOOLEAN DEFAULT true,
        lastlogin TIMESTAMP,
        createdby UUID REFERENCES admins(id),
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    /* ADMIN REFRESH TOKEN */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS adminrefreshtoken (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        adminid UUID REFERENCES admins(id) ON DELETE CASCADE,
        tokenhash TEXT NOT NULL,
        expiresat TIMESTAMP NOT NULL,
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
  CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

    console.log("✅ Database connected & tables verified");
  } catch (error) {
    console.error("❌ Database initialization failed", error);
    process.exit(1);
  }
};

export default pool;
