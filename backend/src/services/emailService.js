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

// O1 (2026-07-26) security fix: escape user-controlled `firstName` before
// interpolating into the HTML template. Attack vector: attacker registers
// with victim's email + name = `<a href="phish.example">verify here</a>`
// (fits in Joi's 60-char name limit); victim's verification email renders
// the anchor in the greeting → phishing. Plain-text arm doesn't render
// HTML so escape only needed for the html: field.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function sendVerificationCode(toEmail, name, code) {
  const firstName = name.split(' ')[0];
  const safeFirstName = escapeHtml(firstName);

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
          <p style="margin:0 0 8px;font-size:16px;color:#2d2d2d;">Hi ${safeFirstName},</p>
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

// O18 AUTH-04: password reset code email. Same visual language as the
// register verification email; different subject + copy.
async function sendPasswordResetCode(toEmail, code) {
  await transporter.sendMail({
    from: `"Cairn" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: `${code} — reset your Cairn password`,
    text: `You (or someone) asked to reset the password for your Cairn account.\n\nYour reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email — your password stays unchanged.\n\n— The Cairn Team`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#faf7f2;">
        <div style="text-align:center;margin-bottom:32px;">
          <span style="font-size:28px;font-weight:900;color:#2d2d2d;letter-spacing:-1px;">Cairn</span>
        </div>
        <div style="background:#fff;border-radius:16px;padding:32px;border:1px solid #e8e4de;">
          <p style="margin:0 0 8px;font-size:16px;color:#2d2d2d;">Reset your password</p>
          <p style="margin:0 0 24px;font-size:15px;color:#6b6b6b;line-height:1.5;">
            Enter this code in Cairn to set a new password:
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#5d7c46;font-family:monospace;">${code}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#9b9b9b;text-align:center;">
            Expires in 15 minutes · Do not share this code
          </p>
        </div>
        <p style="margin:24px 0 0;font-size:12px;color:#b0b0b0;text-align:center;">
          If you didn't ask to reset your password, ignore this email — your account stays unchanged.
        </p>
      </div>
    `,
  });
}

// O18 AUTH-01: account deletion confirmation with restore instructions.
async function sendAccountDeletionConfirmation(toEmail, name, restoreDeadline) {
  const firstName = escapeHtml(name.split(' ')[0]);
  await transporter.sendMail({
    from: `"Cairn" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: 'Your Cairn account is scheduled for deletion',
    text: `Hi ${name.split(' ')[0]},\n\nWe've received a request to delete your Cairn account. Your account and all its data will be permanently removed on ${restoreDeadline}.\n\nIf you change your mind, sign in to Cairn before that date and tap "Restore my account" — no data is lost until the deadline.\n\nIf you didn't request this, sign in immediately and tap Restore.\n\n— The Cairn Team`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#faf7f2;">
        <div style="text-align:center;margin-bottom:32px;">
          <span style="font-size:28px;font-weight:900;color:#2d2d2d;letter-spacing:-1px;">Cairn</span>
        </div>
        <div style="background:#fff;border-radius:16px;padding:32px;border:1px solid #e8e4de;">
          <p style="margin:0 0 8px;font-size:16px;color:#2d2d2d;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#6b6b6b;line-height:1.6;">
            We've received a request to delete your Cairn account. Your account and all its data will be permanently removed on:
          </p>
          <p style="margin:0 0 24px;text-align:center;font-size:16px;font-weight:700;color:#c53d2e;">
            ${restoreDeadline}
          </p>
          <p style="margin:0 0 8px;font-size:15px;color:#6b6b6b;line-height:1.6;">
            If you change your mind:
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#2d2d2d;line-height:1.6;">
            1. Sign in to Cairn before the date above<br>
            2. Tap <strong>Restore my account</strong> when prompted
          </p>
          <p style="margin:0;font-size:13px;color:#9b9b9b;">
            Nothing is lost until the deadline.
          </p>
        </div>
        <p style="margin:24px 0 0;font-size:12px;color:#b0b0b0;text-align:center;">
          If you didn't request this, sign in right now and tap Restore.
        </p>
      </div>
    `,
  });
}

// O18 batch 6.7 (AUTH-GDPR): notify user their data export is ready.
// Sprint 6 round-6 review R6B4 fix: escape both the display name AND
// the download URL. Anchor href needs the scheme validated (https only)
// to prevent javascript: injection; body text needs HTML-entity escape
// for &, <, >, ", '.
async function sendDataExportReady(toEmail, name, downloadUrl) {
  if (!toEmail || !downloadUrl) return;
  // Reject non-https URLs — the download endpoint is always https in
  // production. This closes the javascript: / data: / vbscript:
  // attribute-injection surface.
  const urlStr = String(downloadUrl);
  if (!/^https:\/\//i.test(urlStr)) {
    console.error('[email] sendDataExportReady refusing non-https URL');
    return;
  }
  const displayName = name || 'there';
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(urlStr);
  const subject = 'Your Cairn data export is ready';
  const html = `
    <p>Hi ${safeName},</p>
    <p>Your Cairn data export is ready. Click the link below to download the JSON bundle:</p>
    <p><a href="${safeUrl}">${safeUrl}</a></p>
    <p>The link expires in 24 hours. It contains your hikes, cairns, memory points, routes, friends, and notifications — everything on your account.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    <p>— Cairn</p>
  `;
  const text =
    `Hi ${displayName},\n\n` +
    `Your Cairn data export is ready. Download the JSON bundle here:\n${urlStr}\n\n` +
    `The link expires in 24 hours.\n\n` +
    `If you didn't request this, you can safely ignore this email.\n\n— Cairn`;
  await transporter.sendMail({
    from: `"Cairn" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject,
    html,
    text,
  });
}

// Sprint 6 round-6 review R6B3 fix: exports moved AFTER all declarations.
// Pre-fix, sendDataExportReady was appended after the export block. Works
// today because `function` declarations hoist — but if refactored to
// `const foo = async () => {}` (matches ES-module style elsewhere) the
// export becomes undefined at require time with no runtime error.
module.exports = {
  sendVerificationCode,
  sendPasswordResetCode,
  sendAccountDeletionConfirmation,
  sendDataExportReady,
};
