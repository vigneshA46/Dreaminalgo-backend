import SibApiV3Sdk from "sib-api-v3-sdk";

// ============================
// Configure Brevo API
// ============================
const client = SibApiV3Sdk.ApiClient.instance;

const apiKey = client.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

// ============================
// Send Verification Email
// ============================
export const sendVerificationEmail = async (email, link) => {
  try {
    const emailData = {
      sender: {
        name: "EduHub",
        email: "dreaminalgodevelopmement@gmail.com", // must be verified in Brevo
      },
      to: [
        {
          email: email,
        },
      ],
      subject: "Verify your email",
      htmlContent: `
        <h2>Email Verification</h2>
        <p>Please click below to verify your account:</p>
        <a href="${link}" 
           style="padding:12px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px;">
           Verify Email
        </a>
      `,
    };

    const response = await emailApi.sendTransacEmail(emailData);

    console.log("Brevo Email Sent:", response.messageId);
    return true;

  } catch (error) {
    console.error("Brevo Email Error:", error.response?.body || error);
    return false;
  }
};
 