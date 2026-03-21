import axios from "axios";

export default async function validateDhan(credentials) {

  try {

    const { clientId, pin, totp } = credentials;

    // Basic validation
    if (!clientId || !pin || !totp) {
      return {
        success: false,
        message: "Missing Dhan credentials",
      };
    }

    // API call
    const response = await axios.post(
      `https://auth.dhan.co/app/generateAccessToken`,
      null,
      {
        params: {
          dhanClientId: clientId,
          pin: pin,
          totp: totp
        }
      }
    );

    const data = response.data;

    if (!data.accessToken) {
      return {
        success: false,
        message: "Failed to generate Dhan access token"
      };
    }

    // ✅ STANDARDIZED RESPONSE
    return {
      success: true,
      message: "Dhan connected successfully",
      data: {
        clientId: data.dhanClientId,
        accessToken: data.accessToken,
        tokenExpiry: data.expiryTime,
        extra: {
          clientName: data.dhanClientName,
          ucc: data.dhanClientUcc
        }
      }
    };

  } catch (error) {

    return {
      success: false,
      message: error?.response?.data?.message || "Invalid Dhan credentials"
    };

  }

}