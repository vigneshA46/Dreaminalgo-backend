import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendVerificationEmail = async (email, link) => {
  await transporter.sendMail({
    from: `"EduHub" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Verify your email",
    html: `
      <p>Click below to verify your email:</p>
      <a href="${link}">Verify Email</a>
    `,
  });
};
