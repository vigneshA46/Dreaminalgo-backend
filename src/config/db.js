import pkg from "pg";
const { Pool } = pkg;
import bcrypt from 'bcrypt'


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
    tokens INTEGER DEFAULT 0,
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS broker_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  broker_name VARCHAR(50) NOT NULL,
  client_id VARCHAR(100) NOT NULL,

  credentials JSONB NOT NULL,

  status VARCHAR(20) DEFAULT 'connected',
  token_expires_at TIMESTAMP,
  last_sync TIMESTAMP,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, broker_name, client_id)
  );
  `)

      await pool.query(
        `
      CREATE TABLE IF NOT EXISTS strategies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      name VARCHAR(255) NOT NULL,
      description TEXT,

      created_by UUID REFERENCES users(id),
      is_admin_strategy BOOLEAN DEFAULT false,

      capital_required NUMERIC,
      tokens_required INTEGER DEFAULT 1,

      status VARCHAR(20) DEFAULT 'pending',
      -- pending / approved / rejected / active

      is_paid BOOLEAN DEFAULT false,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
        `
      )

      await pool.query(`
        CREATE TABLE IF NOT EXISTS strategy_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,

  status VARCHAR(20) DEFAULT 'active',
  -- active / expired / cancelled

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
  );  
        `)


      await pool.query(`
        CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id),

  broker_account_id UUID REFERENCES broker_accounts(id),

  status VARCHAR(20) DEFAULT 'pending',
  -- pending / running / stopped / error

  deployed_at TIMESTAMP,
  stopped_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`)


        await pool.query(`CREATE TABLE IF NOT EXISTS deployment_runtime (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  deployment_id UUID UNIQUE REFERENCES deployments(id) ON DELETE CASCADE,

  state JSONB,
  -- positions, pnl, last signal, etc

  last_heartbeat TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`)


    console.log("✅ Database connected & tables verified");
  } catch (error) {
    console.error("❌ Database initialization failed", error);
    process.exit(1);
  }
};

export default pool;
 