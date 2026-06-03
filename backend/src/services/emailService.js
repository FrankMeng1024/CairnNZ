/**
 * Email service — nodemailer + Gmail SMTP
 *
 * Setup: create a Gmail App Password at https://myaccount.google.com/apppasswords
 * Add to .env:
 *   EMAIL_FROM=your@gmail.com
 *   EMAIL_PASS=your_app_password_16chars
 */
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendVerificationCode(toEmail, name, code) {
  const firstName = name.split(' ')[0];

  await transporter.sendMail({
    from: `"Cairn" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: `${code} is your Cairn verification code`,
    text: `Hi ${firstName},\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\n— The Cairn Team`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#faf7f2;">
        <div style="text-align:center;margin-bottom:32px;">
          <span style="font-size:28px;font-weight:900;color:#2d2d2d;letter-spacing:-1px;">Cairn</span>
        </div>
        <div style="background:#fff;border-radius:16px;padding:32px;border:1px solid #e8e4de;">
          <p style="margin:0 0 8px;font-size:16px;color:#2d2d2d;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#6b6b6b;line-height:1.5;">
            Your verification code for Cairn is:
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#5d7c46;font-family:monospace;">${code}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#9b9b9b;text-align:center;">
            Expires in 10 minutes · Do not share this code
          </p>
        </div>
        <p style="margin:24px 0 0;font-size:12px;color:#b0b0b0;text-align:center;">
          If you didn't create a Cairn account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerificationCode };
