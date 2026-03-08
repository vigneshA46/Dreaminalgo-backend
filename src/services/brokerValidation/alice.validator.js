import axios from "axios";

export default async function validateAlice(credentials) {

  try {

    const { userId, apiKey } = credentials;

    if (!userId || !apiKey) {
      return {
        success: false,
        message: "Missing Alice Blue credentials"
      };
    }

    const response = await axios.post(
      "https://api.aliceblueonline.com/rest/authenticate",
      {
        userId: userId
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey
        }
      }
    );

    const data = response.data;

    if (data.stat !== "Ok") {
      return {
        success: false,
        message: data.emsg || "Alice Blue authentication failed"
      };
    }

    return {
      success: true,
      message: "Alice Blue connected successfully",
      tokens: {
        accessToken: data.accessToken
      }
    };

  } catch (error) {

    return {
      success: false,
      message: "Invalid Alice Blue credentials"
    };

  }

}