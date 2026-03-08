import axios from "axios";

export default async function validateDhan(credentials) {

  try {

    const { clientId, accessToken } = credentials;

    const response = await axios.get(
      "https://api.dhan.co/v2/profile",
      {
        headers: {
          "access-token": accessToken
        }
      }
    );

    const data = response.data;

    if (data.dhanClientId !== clientId) {
      return {
        success: false,
        message: "Client ID does not match Dhan account"
      };
    }

    return {
      success: true,
      message: "Dhan connected successfully",
      tokenExpiry: data.tokenValidity,
      profile: data
    };

  } catch (error) {

    return {
      success: false,
      message: "Invalid Dhan access token"
    };

  }

}