import axios from "axios";

export default async function validateDhan(credentials) {
  try {
    const { clientId, access_token } = credentials;

    console.log(clientId, access_token);

    // Basic validation
    if (!clientId || !access_token) {
      return {
        success: false,
        message: "Missing Dhan credentials",
      };
    }

    // 🔥 Profile API (validation endpoint)
    const url = "https://api.dhan.co/v2/profile";

    const response = await axios.get(url, {
      headers: {
        "access-token": access_token,
        "Content-Type": "application/json",
      },
    });

    const data = response.data;
    console.log(data);

    // Validate response
    if (!data || !data.dhanClientId) {
      return {
        success: false,
        message: "Invalid Dhan access token",
      };
    }

    // Optional: extra safety check
    if (clientId !== data.dhanClientId) {
      return {
        success: false,
        message: "Client ID mismatch",
      };
    }

    // ✅ STANDARDIZED RESPONSE
    return {
      success: true,
      message: "Dhan connected successfully",
      data: {
        clientId: data.dhanClientId,
        accessToken: access_token,
        tokenValidity: data.tokenValidity,
      },
    };

  } catch (error) {
    console.error(error?.response?.data || error.message);

    return {
      success: false,
      message:
        error?.response?.data?.message ||
        "Failed to validate Dhan credentials",
    };
  }
}