import axios from "axios";
import crypto from "crypto";
import speakeasy from "speakeasy";

export default async function validateZebu(credentials) {
  try {
    const { uid, password, apiKey, factor2 } = credentials;

    if (!uid || !password || !apiKey || !factor2) {
      return {
        success: false,
        message: "Missing Zebu credentials"
      };
    }

    // 🔐 SHA256 helper
    const sha256 = (data) => {
      return crypto.createHash("sha256").update(data).digest("hex");
    };

    // 🔐 Generate TOTP from secret
    const otp = speakeasy.totp({
      secret: factor2,      // 🔑 your TOTP secret
      encoding: "base32",   // ⚠️ usually base32
    });

    // 🔐 Hashing
    const pwdHash = sha256(password);
    const appKeyHash = sha256(`${uid}|${apiKey}`);

    const url = "https://go.mynt.in/NorenWClientTP/QuickAuth";

    const jData = {
      uid: uid,
      pwd: pwdHash,
      factor2: otp,  // ✅ USE GENERATED OTP
      apkversion: "1.0.0",
      imei: "12345678",
      vc: uid,
      appkey: appKeyHash,
      source: "API"
    };

    const payload = "jData=" + JSON.stringify(jData);

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const data = response.data;

    if (data.stat !== "Ok") {
      return {
        success: false,
        message: data.emsg || "Zebu login failed"
      };
    }

    return {
      success: true,
      message: "Zebu connected successfully",
      tokens: {
        jKey: data.susertoken,
        actid: data.actid
      }
    };

  } catch (error) {
    console.error(error.response?.data || error.message);

    return {
      success: false,
      message: "Invalid Zebu credentials"
    };
  }
}