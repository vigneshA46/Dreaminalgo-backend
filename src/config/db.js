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
  client_id VARCHAR(100) ,

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
  CREATE TABLE IF NOT EXISTS paper_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  run_id UUID,
  strategy_id UUID,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  event_type VARCHAR(20),   -- ENTRY / EXIT
  leg_name VARCHAR(100),
  token BIGINT,
  symbol VARCHAR(50),
  side VARCHAR(10),         -- BUY / SELL
  lots INTEGER,
  quantity INTEGER,
  price NUMERIC,
  trade_id UUID,            -- 🔥 links entry & exit
  reason TEXT,
  deployed_by UUID,
  pnl TEXT,
  cum_pnl TEXT,
  createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

      await pool.query(`
  CREATE TABLE IF NOT EXISTS paper_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID,

    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    strategy_id UUID,
    leg_name VARCHAR(100),

    token BIGINT,
    symbol VARCHAR(50),

    action VARCHAR(100),
    price NUMERIC,

    log_type VARCHAR(50),
    remark TEXT,

    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

        await pool.query(`
CREATE TABLE IF NOT EXISTS trader_signal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    creator_name TEXT NOT NULL,
    index_id TEXT NOT NULL,
    description TEXT,
    index_name TEXT NOT NULL,
    config_json JSONB NOT NULL,
    status TEXT DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);



await pool.query(`
  CREATE TABLE IF NOT EXISTS instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name VARCHAR(100) NOT NULL,
    segment VARCHAR(10) NOT NULL,
    dhan VARCHAR(50),
    smartapi VARCHAR(50),
    kite VARCHAR(50),
    aliceblue VARCHAR(50),
    zebu VARCHAR(50),
    flattrade VARCHAR(50)
  );
`); 

await pool.query(`
  CREATE TABLE IF NOT EXISTS create_strategy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    index_id VARCHAR(30),
    startergy_name VARCHAR(30), 
    description TEXT,
    entry_settings JSONB,
    config_json JSONB,
    status VARCHAR(20),
    created_by VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

await pool.query(`
      CREATE TABLE IF NOT EXISTS trade_legs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        startergy_id TEXT,
        leg VARCHAR(2) CHECK (leg IN ('CE','PE')) NOT NULL,
        symbol TEXT NOT NULL,
        strike_price NUMERIC NOT NULL,
        date DATE NOT NULL,
        pnl NUMERIC DEFAULT 0
      );
    `);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL,

  type VARCHAR(20) NOT NULL, -- paper | dhan | angelone

  broker_account_id UUID NULL REFERENCES broker_accounts(id) ON DELETE SET NULL,

  status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE | STOPPED | FAILED

  multiplier INTEGER NOT NULL,

  deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  )

  await pool.query(`
CREATE TABLE IF NOT EXISTS real_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id BIGINT NOT NULL,
    strategy_id BIGINT NOT NULL,
    broker_id BIGINT NOT NULL,

    order_id VARCHAR(100),

    event_type VARCHAR(10) NOT NULL,
    leg_name VARCHAR(10),
    symbol VARCHAR(50) NOT NULL,

    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(10),
    product_type VARCHAR(20),
    exchange VARCHAR(10),

    lot INTEGER,
    quantity INTEGER NOT NULL,
    filled_quantity INTEGER DEFAULT 0,

    price NUMERIC(10, 2),
    average_price NUMERIC(10, 2),

    status VARCHAR(15) NOT NULL,

    reason TEXT,

    timestamp TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,

    pnl NUMERIC(12, 2) DEFAULT 0,
    cum_pnl NUMERIC(12, 2) DEFAULT 0,

    raw_response JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);



    console.log("✅ Database connected & tables verified");
  } catch (error) {
    console.error("❌ Database initialization failed", error);
    process.exit(1);
  }
};

export default pool;
 