import axios from "axios";
import { generateSync } from "otplib";


export default async function validateDhan(credentials) {

  try {

    const { clientId, pin, totp } = credentials;
    
    console.log(clientId , pin , totp)
    const secret = totp

    const totpin = generateSync({secret});



    // Basic validation
    if (!clientId || !pin || !totp) {
      return {
        success: false,
        message: "Missing Dhan credentials",
      };
    }

    // API call
    const url = "https://auth.dhan.co/app/generateAccessToken";

    const response = await axios.post(url, null, {
      params: {
        dhanClientId: clientId,
        pin: pin,
        totp: totpin,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data =await response.data;
    await console.log(data)
    

    if (!data) {
      return {
        success: false,
        message: "Failed to generate Dhan access token"
      };
    }

    // ✅ STANDARDIZED RESPONSE
    return {
      success: true,
      message: "Dhan connected successfully",
      data
    };

  } catch (error) {

    return {
      success: false,
      message: error
    };

  }

}