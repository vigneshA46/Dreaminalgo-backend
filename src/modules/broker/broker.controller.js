import pool from "../../config/db.js";
import { validateBrokerConnection } from "../../services/brokerValidation/brokerValidator.js";
import crypto from "crypto";
import axios from "axios";
import { generate } from "otplib";





/*
  CONNECT BROKER
*/
export const connectBroker = async (req, res) => {
    let validation = null;

  try {

    const userId = req.user.id;
    const { brokerName, credentials } = req.body;

    const normalizedBroker = brokerName.toLowerCase();

    if (!brokerName || !credentials) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate broker connection
    if (normalizedBroker !== "aliceblue" && normalizedBroker !== "upstox") {
  validation = await validateBrokerConnection(
    normalizedBroker,
    credentials
  );

  if (!validation.success) {
    return res.status(400).json({
      error: validation.message
    });
  }
}

    const existing = await pool.query(
      `
      SELECT id FROM broker_accounts
      WHERE user_id = $1 AND broker_name = $2
      `,
      [userId, normalizedBroker]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: "Broker already connected"
      });
    }

    

    if(normalizedBroker == 'dhan'){
      
      const brokerData = {
      clientId: validation.data.clientId,
      pin: credentials.pin,
      totp: credentials.totp, // (your secret)
      accessToken: validation.data.accessToken,
      expiryTime: validation.data.expiryTime
    };
    const result = await pool.query(
    `
      INSERT INTO broker_accounts
      (user_id, broker_name, credentials, status, client_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
    [
      userId,
      normalizedBroker,
      brokerData,
      "connected",
      "test"
    ]
    );

    res.status(201).json({
      message: `${normalizedBroker} connected successfully`,
      broker: result.rows[0]
    });

    }
    else if(normalizedBroker == 'angelone'){
      const result = await pool.query(
    `
      INSERT INTO broker_accounts
      (user_id, broker_name, credentials, status, client_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
    [
      userId,
      normalizedBroker,
      credentials,
      "connected",
      "test"
    ]
    );

    res.status(201).json({
      message: `${normalizedBroker} connected successfully`,
      broker: result.rows[0]
    });
    }
    else if (normalizedBroker === 'zebumynt') {

  const brokerData = {
    uid: credentials.uid,
    password: credentials.password,   // optional (or encrypt later)
    apiKey: credentials.apiKey,
    factor2: credentials.factor2,
    jKey: validation.tokens.jKey,
    actid: validation.tokens.actid
  };

  const result = await pool.query(
    `
    INSERT INTO broker_accounts
    (user_id, broker_name, credentials, status, client_id)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [
      userId,
      normalizedBroker,
      brokerData,        // ✅ full JSON stored here
      "connected",
      "NA"               // ✅ dummy client_id
    ]
  );

  return res.status(201).json({
    message: `${normalizedBroker} connected successfully`,
    broker: result.rows[0]
  });
    }
    else if (normalizedBroker === 'aliceblue') {

  const brokerData = {
    userId: credentials.userId,
    apiKey: credentials.apiKey,
    appCode: credentials.appCode,
    authCode: "",
    sessionID: ""
  };

  const result = await pool.query(
    `
    INSERT INTO broker_accounts
    (user_id, broker_name, credentials, status, client_id)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [
      userId,
      normalizedBroker,
      brokerData,
      "connected",
      "NA"
    ]
  );

  return res.status(201).json({
    message: "aliceblue added successfully",
    broker: result.rows[0]
  });
    }
    else if (normalizedBroker === "upstox") {

  const brokerData = {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    redirectUri: credentials.redirectUri,
    code: "",
    accessToken: ""
  };

  const result = await pool.query(
    `
    INSERT INTO broker_accounts
    (user_id, broker_name, credentials, status, client_id)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [
      userId,
      normalizedBroker,
      brokerData,
      "connected",   // IMPORTANT 
      "NA"
    ]
  );

  return res.status(201).json({
    message: "upstox added successfully",
    broker: result.rows[0]
  });
    }
    else if (normalizedBroker === "flattrade") {

  const brokerData = {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    redirectUri: credentials.redirectUri,
    requestCode: "",
    accessToken: "",
    clientId: ""
  };

  const result = await pool.query(
    `
    INSERT INTO broker_accounts
    (user_id, broker_name, credentials, status, client_id)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [
      userId,
      normalizedBroker,
      brokerData,
      "pending",   // ⛔ IMPORTANT (not connected yet)
      "NA"
    ]
  );

  return res.status(201).json({
    message: "flattrade added successfully",
    broker: result.rows[0]
  });
}
  } catch (error) {

    console.error("Connect Broker Error:", error);
    res.status(500).json({ error: "Server error" });

  }

};


/*
  GET ALL USER BROKERS
*/
export const getUserBrokers = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT id, broker_name, client_id, status, token_expires_at, created_at, credentials, updated_at
      FROM broker_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Get Brokers Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};



/*
  GET SINGLE BROKER
*/
export const getBrokerById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT id, broker_name, client_id, status, token_expires_at, created_at
      FROM broker_accounts
      WHERE id = $1 AND user_id = $2
      `,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get Broker Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  DELETE BROKER
*/
export const deleteBroker = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM broker_accounts
      WHERE id = $1 AND user_id = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json({ message: "Broker disconnected successfully" });

  } catch (error) {
    console.error("Delete Broker Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  ADMIN: UPDATE BROKER STATUS
*/
export const updateBrokerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      `
      UPDATE broker_accounts
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json({
      message: "Status updated",
      broker: result.rows[0],
    });

  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateBrokerCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const { credentials } = req.body; // should be an object

    const result = await pool.query(
      `
      UPDATE broker_accounts
      SET credentials = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [credentials, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json({
      message: "Credentials updated",
      broker: result.rows[0],
    });

  } catch (error) {
    console.error("Update Credentials Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};
 

/* get useer base broker */

export const getUserbaseBrokers = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT id, broker_name
      FROM broker_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Get Brokers Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};


export const aliceCallback = async (req, res) => {
  try {
    const userIdFromJWT = req.user.id;
    const { userId, authCode, apiKey } = req.body;

    if (!userId || !authCode || !apiKey) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    // 🔐 checksum
    const checksum = crypto
      .createHash("sha256")
      .update(userId + authCode + apiKey)
      .digest("hex");

    const response = await axios.post(
      "https://ant.aliceblueonline.com/rest/auth",
      {
        userId,
        authCode,
        checksum
      }
    );

    const data = response.data;

    if (data.stat !== "Ok") {
      return res.status(400).json({
        error: data.emsg || "Alice login failed"
      });
    }

    // 🔍 Check already exists
    const existing = await pool.query(
      `SELECT id FROM broker_accounts WHERE user_id = $1 AND broker_name = $2`,
      [userIdFromJWT, "aliceblue"]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: "Broker already connected"
      });
    }

    // ✅ Store
    const brokerData = {
      userId,
      apiKey,
      sessionID: data.sessionID
    };

    const result = await pool.query(
      `
      INSERT INTO broker_accounts
      (user_id, broker_name, credentials, status, client_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        userIdFromJWT,
        "aliceblue",
        brokerData,
        "connected",
        "NA"
      ]
    );

    return res.json({
      message: "aliceblue connected successfully",
      broker: result.rows[0]
    });

  } catch (err) {
    console.error("Alice Callback Error:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Alice connection failed"
    });
  }
};


export const aliceSession = async (req, res) => {
  try {
    const { userId, authCode, apiKey } = req.body;

    if (!userId || !authCode || !apiKey) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    // 🔐 checksum = userId + authCode + apiKey
    const checksum = crypto
      .createHash("sha256")
      .update(userId + authCode + apiKey)
      .digest("hex");

    // ✅ CORRECT API
    const response = await axios.post(
      "https://ant.aliceblueonline.com/open-api/od/v1/vendor/getUserDetails",
      {
        checkSum: checksum
      },
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    const data = response.data;

    if (data.stat !== "Ok") {
      return res.status(400).json({
        error: data.emsg || "Alice session failed"
      });
    }

    return res.json({
      sessionID: data.userSession,   // ✅ correct field
      clientId: data.clientId
    });

  } catch (err) {
    console.error("Alice Session Error:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Session generation failed"
    });
  }
};

export const upstoxCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    // get broker id (preferred from state OR localStorage fallback)
    const brokerId = state || req.query.brokerId;

    if (!brokerId) {
      return res.status(400).json({ error: "Missing brokerId" });
    }

    const brokerRes = await pool.query(
      `SELECT * FROM broker_accounts WHERE id = $1`,
      [brokerId]
    );

    const broker = brokerRes.rows[0];

    if (!broker) {
      return res.status(404).json({ error: "Broker not found" });
    }

    const { apiKey, apiSecret, redirectUri } = broker.credentials;

    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      new URLSearchParams({
        code,
        client_id: apiKey,
        client_secret: apiSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const data = response.data;

    // update DB
    await pool.query(
      `
      UPDATE broker_accounts
      SET credentials = credentials || $1::jsonb,
          status = 'connected'
      WHERE id = $2
      `,
      [
        {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null
        },
        brokerId
      ]
    );

    return res.redirect("http://localhost:5173/brokers");

  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({ error: "Upstox callback failed" });
  }
};


export const upstoxSession = async (req, res) => {
  try {
    const { code, apiKey, apiSecret, redirectUri } = req.body;

    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      new URLSearchParams({
        code,
        client_id: apiKey,
        client_secret: apiSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const data = response.data;

    return res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({ error: "Upstox session failed" });
  }
};


export const flattradeCallback = async (req, res) => {
  try {
    const { request_code, state } = req.query;

    const brokerId = state;

    if (!request_code || !brokerId) {

      return res.status(400).json({ error: "Missing request_code or brokerId" });
    }

    // 🔍 Get broker from DB
    const brokerRes = await pool.query(
      `SELECT * FROM broker_accounts WHERE id = $1`,
      [brokerId]
    );

    const broker = brokerRes.rows[0];

    if (!broker) {
      return res.status(404).json({ error: "Broker not found" });
    }

    const { apiKey, apiSecret } = broker.credentials;

    // 🔐 SHA256(apiKey + request_code + apiSecret)
    const crypto = await import("crypto");

    const hash = crypto
      .createHash("sha256")
      .update(apiKey + request_code + apiSecret)
      .digest("hex");

    // 🔁 Exchange token
    const response = await axios.post(
      "https://authapi.flattrade.in/trade/apitoken",
      {
        api_key: apiKey,
        request_code,
        api_secret: hash
      }
    );
    console.log(response)

    const data = response.data;


    if (data.status !== "Ok") {
      return res.status(400).json({
        error: data.emsg || "FlatTrade auth failed"
      });
    }

    // ✅ Update DB
    await pool.query(
      `
      UPDATE broker_accounts
      SET credentials = credentials || $1::jsonb,
          status = 'connected'
      WHERE id = $2
      `,
      [
        {
          accessToken: data.token,
          clientId: data.client
        },
        brokerId
      ]
    );

    return res.redirect("http://localhost:5173/brokers");

  } catch (err) {
    console.error("FlatTrade Callback Error:", err.response?.data || err.message);

    return res.status(500).json({
      error: "FlatTrade connection failed"
    });
  }
};


/*
  GET ALL BROKERS WITH USER DATA + CREDENTIALS
*/
export const getAllBrokersWithUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        -- BROKER DATA
        b.id AS broker_id,
        b.user_id,
        b.broker_name,
        b.client_id,
        b.credentials,
        b.status AS broker_status,
        b.token_expires_at,
        b.last_sync,
        b.created_at AS broker_created_at,
        b.updated_at AS broker_updated_at,

        -- USER DATA
        u.id AS user_id,
        u.fullname AS user_fullname,
        u.email AS user_email,
        u.mobile_number AS user_mobile,
        u.role AS user_role,
        u.isactive AS user_isactive,
        u.tokens AS user_tokens,
        u.auth_provider AS user_auth_provider,
        u.remarks AS user_remarks,
        u.status AS user_status,
        u.createdat AS user_created_at,
        u.updatedat AS user_updated_at

      FROM broker_accounts b

      LEFT JOIN users u
        ON b.user_id = u.id

      ORDER BY b.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      brokers: result.rows
    });

  } catch (error) {
    console.error("Get All Brokers With Users Error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};


const ZEBU_BASE_URL = "https://go.mynt.in/NorenWClientTP";

const sha256 = (data) => {
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex");
};


const zebuLogin = async ({
  uid,
  password,
  apiKey,
  factor2,
  vendorCode = "ZEBU",
}) => {
  try {
    const pwdHash = sha256(password);
    const appkeyHash = sha256(`${uid}|${apiKey}`);

    // Generate TOTP
    const otp = await generate({
      secret: factor2,
    });

    console.log("Generated Zebu OTP");

    const loginData = {
      uid: uid,
      pwd: pwdHash,
      factor2: otp,
      apkversion: "1.0.0",
      imei: "12345678",
      vc: uid,
      appkey: appkeyHash,
      source: "API",
    };

    const payload =
      "jData=" +
      JSON.stringify(loginData);

    console.log("Zebu QuickAuth payload created:", {
      uid,
      vendorCode: uid,
      hasPasswordHash: !!pwdHash,
      hasAppKeyHash: !!appkeyHash,
      hasOtp: !!otp,
    });

    const response = await axios.post(
      `${ZEBU_BASE_URL}/QuickAuth`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },

        timeout: 10000,

        // Do not throw for Zebu's HTTP error responses
        validateStatus: () => true,

        // Prevent Axios from transforming the body
        transformRequest: [
          (data) => data,
        ],
      }
    );

    console.log(
      "Zebu QuickAuth HTTP Status:",
      response.status
    );

    console.log(
      "Zebu QuickAuth Response:",
      response.data
    );

    const result = response.data;

    if (result.stat !== "Ok") {
      throw new Error(
        result.emsg ||
        "Zebu login failed"
      );
    }

    return {
      jKey: result.susertoken,
      actid: result.actid,
    };

  } catch (error) {
    console.error(
      "Zebu QuickAuth Error:",
      error.response?.data ||
      error.message
    );

    throw error;
  }
};


const fetchZebuClientDetails = async ({ uid, actid, jKey }) => {
  const data = {
    uid,
    actid,
    brkname: "ZEBU",
  };

  const payload =
    "jData=" +
    JSON.stringify(data) +
    "&jKey=" +
    jKey;

  const response = await fetch(
    `${ZEBU_BASE_URL}/ClientDetails`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    }
  );

  const result = await response.json();

  console.log("Zebu ClientDetails HTTP Status:", response.status);
  console.log("Zebu ClientDetails Response:", result);

  return result;
};


const fetchZebuLimits = async ({ uid, actid, jKey }) => {
  const data = {
    uid,
    actid,
  };

  const payload =
    "jData=" +
    JSON.stringify(data) +
    "&jKey=" +
    jKey;

  const response = await fetch(
    `${ZEBU_BASE_URL}/Limits`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    }
  );

  const result = await response.json();

  console.log("Zebu Limits HTTP Status:", response.status);
  console.log("Zebu Limits Response:", result);

  return result;
};




export const getZebuMargin = async (req, res) => {
  try {
    const {
      uid,
      actid,
      jKey,
      password,
      apiKey,
      factor2,
      vendorCode,
    } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: "uid is required",
      });
    }

    if (!password || !apiKey || !factor2) {
      return res.status(400).json({
        success: false,
        error:
          "password, apiKey and factor2 are required",
      });
    }

    let currentJKey = jKey;
    let currentActid = actid || uid;

    /*
     * -----------------------------------------
     * 1. Try existing session
     * -----------------------------------------
     */

    if (currentJKey) {
      console.log("Trying existing Zebu session...");

      const result = await fetchZebuLimits({
        uid,
        actid: currentActid,
        jKey: currentJKey,
      });

      if (result.stat === "Ok") {
        console.log(
          "Existing Zebu session is valid."
        );

        return res.status(200).json({
          success: true,
          sessionRefreshed: false,

          availableMargin: Number(
            result.cash || 0
          ),

          margin: {
            cash: Number(result.cash || 0),
            payin: Number(result.payin || 0),
            payout: Number(result.payout || 0),
            collateral: Number(
              result.collateral || 0
            ),

            marginUsed: Number(
              result.marginused || 0
            ),

            span: Number(result.span || 0),
            exposure: Number(result.expo || 0),
            premium: Number(
              result.premium || 0
            ),

            realizedPnl: Number(
              result.rpnl || 0
            ),

            unrealizedPnl: Number(
              result.unmtom || 0
            ),

            pendingOrderValue: Number(
              result.pendordval || 0
            ),

            turnover: Number(
              result.turnover || 0
            ),
          },
        });
      }

      console.log(
        "Existing Zebu session invalid:",
        result.emsg
      );
    }

    /*
     * -----------------------------------------
     * 2. Login again
     * -----------------------------------------
     */

    console.log(
      "Refreshing Zebu session..."
    );

    const loginResult = await zebuLogin({
      uid,
      password,
      apiKey,
      factor2,
      vendorCode: uid,
    });

    currentJKey = loginResult.jKey;
    currentActid = loginResult.actid;

    /*
     * -----------------------------------------
     * 3. Retry Limits
     * -----------------------------------------
     */

    console.log(
      "Fetching Zebu limits with fresh session..."
    );

    const result = await fetchZebuLimits({
      uid,
      actid: currentActid,
      jKey: currentJKey,
    });

    if (result.stat !== "Ok") {
      console.error(
        "Zebu Limits failed after login:",
        result
      );

      return res.status(400).json({
        success: false,
        error:
          result.emsg ||
          "Failed to fetch Zebu margin",
      });
    }

    /*
     * -----------------------------------------
     * 4. Success
     * -----------------------------------------
     */

    return res.status(200).json({
      success: true,
      sessionRefreshed: true,

      // Fresh session information
      session: {
        jKey: currentJKey,
        actid: currentActid,
      },

      availableMargin: Number(
        result.cash || 0
      ),

      margin: {
        cash: Number(result.cash || 0),
        payin: Number(result.payin || 0),
        payout: Number(result.payout || 0),
        collateral: Number(
          result.collateral || 0
        ),

        marginUsed: Number(
          result.marginused || 0
        ),

        span: Number(result.span || 0),
        exposure: Number(result.expo || 0),
        premium: Number(
          result.premium || 0
        ),

        realizedPnl: Number(
          result.rpnl || 0
        ),

        unrealizedPnl: Number(
          result.unmtom || 0
        ),

        pendingOrderValue: Number(
          result.pendordval || 0
        ),

        turnover: Number(
          result.turnover || 0
        ),
      },
    });

  } catch (error) {
    console.error(
      "Zebu Margin Error:",
      error.response?.data ||
      error.message
    );

    return res.status(500).json({
      success: false,
      error:
        error.response?.data?.emsg ||
        error.message ||
        "Failed to fetch Zebu margin",
    });
  }
};
