import axios from "axios";
import { generateSync } from "otplib";

/**
 * Generate Dhan Access Token
 * @param {Object} params
 * @param {string} params.clientId
 * @param {string} params.pin
 * @param {string} params.totp
 * @returns {Promise<Object>}
*/
async function generateAccessToken({ clientId, pin, totpsecret }) {
  
  const secret = totpsecret; // your secret
const totp = generateSync({ secret });

  try {
    const url = "https://auth.dhan.co/app/generateAccessToken";

    const response = await axios.post(url, null, {
      params: {
        dhanClientId: clientId,
        pin: pin,
        totp: totp,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error("❌ Error generating access token:", error.response?.data || error.message);
    throw error;
  }
}


const data = await generateAccessToken({
    clientId: "1107425275",
    pin: "333786",
    totpsecret: "NCANVUXV6ZJDXLTV2QYWVK2FGKHN4XLW",
  });

  console.log("✅ Token Response:", data);