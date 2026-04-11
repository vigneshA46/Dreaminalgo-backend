import axios from "axios";
import crypto from "crypto";

export default async function validateZebu(credentials) {
  try {
    const { uid, password, apiKey, factor2 } = credentials;

    // 🔴 Check missing fields
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

    // 🔐 Hashing (same as Python)
    const pwdHash = sha256(password);
    const appKeyHash = sha256(`${uid}|${apiKey}`);

    const url = "https://go.mynt.in/NorenWClientTP/QuickAuth";

    const jData = {
      uid: uid,
      pwd: pwdHash,
      factor2: factor2,
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

    console.log(response.data)

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
    return {
      success: false,
      message: "Invalid Zebu credentials"
    };
  }
}