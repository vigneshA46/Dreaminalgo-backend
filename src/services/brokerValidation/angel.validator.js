import axios from "axios";
import speakeasy from "speakeasy";

export default async function validateAngel(credentials) {

  try {

    const { clientCode, apiKey, pin, totpSecret } = credentials;

    // Generate TOTP
    const totp = speakeasy.totp({
      secret: totpSecret,
      encoding: "base32"
    });

    const payload = {
      clientcode: clientCode,
      password: pin,
      totp: totp
    };

    const response = await axios.post(
      "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": apiKey
        }
      }
    );

    const data = response.data;

    if (!data.status) {
      return {
        success: false,
        message: "Angel One login failed"
      };
    }

    return {
      success: true,
      message: "Angel One connected successfully",
      tokens: {
        jwtToken: data.data.jwtToken,
        refreshToken: data.data.refreshToken,
        feedToken: data.data.feedToken
      }
    };

  } catch (error) {

    return {
      success: false,
      message: "Invalid Angel One credentials"
    };

  }

}
