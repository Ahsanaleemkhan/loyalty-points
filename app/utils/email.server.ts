/**
 * Email notification utility using Shopify's built-in emailMarketing API
 * (no third-party dependency required).
 *
 * Uses the Shopify Admin GraphQL `customerSendEmail` mutation.
 * Falls back to a no-op with console.log if emailEnabled is false.
 */

interface AdminGraphql {
  (query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

export interface EmailPayload {
  to: string;
  customerName: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
}

export async function sendEmail(
  admin: { graphql: AdminGraphql },
  payload: EmailPayload,
): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
      mutation sendEmail($input: CustomerEmailInput!) {
        customerSendEmail(input: $input) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            to: payload.to,
            subject: payload.subject,
            body: payload.bodyHtml,
            from: payload.fromName,
          },
        },
      },
    );
    const data = await res.json() as { data?: { customerSendEmail?: { userErrors: { message: string }[] } } };
    const errors = data.data?.customerSendEmail?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("Email send errors:", errors);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
}

// ── Email Templates ──────────────────────────────────────────────────────────

function baseTemplate(content: string, fromName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin:0; padding:0; background:#f5f5f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#202223; }
    .wrapper { max-width:560px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
    .header { background:#008060; padding:24px 32px; }
    .header h1 { margin:0; color:#fff; font-size:22px; font-weight:700; }
    .body { padding:32px; }
    .highlight { background:#f6f6f7; border-radius:8px; padding:20px; margin:20px 0; }
    .code { font-family:monospace; font-size:22px; font-weight:700; color:#008060; letter-spacing:2px; }
    .footer { padding:16px 32px; background:#f6f6f7; font-size:12px; color:#6d7175; text-align:center; }
    .badge { display:inline-block; padding:4px 12px; border-radius:12px; font-size:13px; font-weight:600; }
    .badge-green { background:#d1fae5; color:#065f46; }
    .badge-red { background:#fee2e2; color:#b91c1c; }
    .badge-gold { background:#fef3c7; color:#92400e; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>${fromName}</h1></div>
    <div class="body">${content}</div>
    <div class="footer">You are receiving this email because you have a loyalty account with us.</div>
  </div>
</body>
</html>`;
}

export function submissionApprovedEmail(params: {
  customerName: string;
  points: number;
  discountCode?: string;
  discountValue?: number;
  currency: string;
  fromName: string;
  balance: number;
}): { subject: string; bodyHtml: string } {
  const { customerName, points, discountCode, discountValue, currency, fromName, balance } = params;
  const subject = `Your receipt has been approved — +${points} points!`;
  const body = `
    <p>Hi ${customerName || "there"},</p>
    <p>Great news! Your physical receipt submission has been <strong>approved</strong>.</p>
    <div class="highlight">
      <div style="margin-bottom:8px;"><span class="badge badge-green">+${points} Points Earned</span></div>
      <div style="font-size:14px;color:#6d7175;">New Balance: <strong>${balance.toLocaleString()} points</strong></div>
    </div>
    ${discountCode ? `
    <p>You can use these points to redeem discount codes in our loyalty widget:</p>
    <div class="highlight" style="text-align:center;">
      <div style="font-size:13px;color:#6d7175;margin-bottom:8px;">Your Discount Code</div>
      <div class="code">${discountCode}</div>
      <div style="font-size:13px;color:#6d7175;margin-top:8px;">Value: ${currency} ${(discountValue ?? 0).toFixed(2)}</div>
    </div>` : ""}
    <p>Keep earning points on every purchase!</p>`;
  return { subject, bodyHtml: baseTemplate(body, fromName) };
}

export function submissionRejectedEmail(params: {
  customerName: string;
  adminNotes: string;
  fromName: string;
}): { subject: string; bodyHtml: string } {
  const { customerName, adminNotes, fromName } = params;
  const subject = "Update on your receipt submission";
  const body = `
    <p>Hi ${customerName || "there"},</p>
    <p>We have reviewed your receipt submission.</p>
    <div class="highlight">
      <div style="margin-bottom:8px;"><span class="badge badge-red">Submission Not Approved</span></div>
      ${adminNotes ? `<div style="font-size:14px;color:#6d7175;margin-top:8px;"><strong>Reason:</strong> ${adminNotes}</div>` : ""}
    </div>
    <p>If you have questions, please contact us. You can submit a new receipt at any time.</p>`;
  return { subject, bodyHtml: baseTemplate(body, fromName) };
}

export function pointsEarnedEmail(params: {
  customerName: string;
  points: number;
  orderAmount: string;
  balance: number;
  fromName: string;
}): { subject: string; bodyHtml: string } {
  const { customerName, points, orderAmount, balance, fromName } = params;
  const subject = `You earned ${points} loyalty points!`;
  const body = `
    <p>Hi ${customerName || "there"},</p>
    <p>Thank you for your purchase! You have just earned loyalty points.</p>
    <div class="highlight">
      <div style="margin-bottom:8px;"><span class="badge badge-gold">+${points} Points Earned</span></div>
      <div style="font-size:14px;color:#6d7175;">Order Amount: <strong>${orderAmount}</strong></div>
      <div style="font-size:14px;color:#6d7175;margin-top:4px;">Total Balance: <strong>${balance.toLocaleString()} points</strong></div>
    </div>
    <p>Log in to your account to view your points balance and redeem for discounts.</p>`;
  return { subject, bodyHtml: baseTemplate(body, fromName) };
}

export function redemptionEmail(params: {
  customerName: string;
  discountCode: string;
  discountValue: number;
  currency: string;
  pointsSpent: number;
  newBalance: number;
  fromName: string;
}): { subject: string; bodyHtml: string } {
  const { customerName, discountCode, discountValue, currency, pointsSpent, newBalance, fromName } = params;
  const subject = `Your discount code: ${discountCode}`;
  const body = `
    <p>Hi ${customerName || "there"},</p>
    <p>You have successfully redeemed <strong>${pointsSpent} points</strong> for a discount.</p>
    <div class="highlight" style="text-align:center;">
      <div style="font-size:13px;color:#6d7175;margin-bottom:8px;">Your Discount Code</div>
      <div class="code">${discountCode}</div>
      <div style="font-size:14px;margin-top:12px;color:#202223;">
        Value: <strong>${currency} ${discountValue.toFixed(2)}</strong>
      </div>
    </div>
    <p>Use this code at checkout. Remaining balance: <strong>${newBalance.toLocaleString()} points</strong>.</p>
    <p>This code is single-use and valid for one order.</p>`;
  return { subject, bodyHtml: baseTemplate(body, fromName) };
}

export function tierUpgradeEmail(params: {
  customerName: string;
  tierName: string;
  tierColor: string;
  multiplier: number;
  perks: string[];
  fromName: string;
}): { subject: string; bodyHtml: string } {
  const { customerName, tierName, tierColor, multiplier, perks, fromName } = params;
  const subject = `Congratulations! You reached ${tierName} tier`;
  const body = `
    <p>Hi ${customerName || "there"},</p>
    <p>Congratulations! You have reached a new loyalty tier.</p>
    <div class="highlight" style="text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">🏆</div>
      <div style="font-size:22px;font-weight:700;color:${tierColor};">${tierName}</div>
      <div style="font-size:14px;color:#6d7175;margin-top:8px;">${multiplier}x Points on every purchase</div>
    </div>
    ${perks.length > 0 ? `
    <p><strong>Your ${tierName} perks:</strong></p>
    <ul style="padding-left:20px;color:#6d7175;">${perks.map((p) => `<li style="margin-bottom:6px;">${p}</li>`).join("")}</ul>` : ""}
    <p>Keep earning points to unlock even more rewards!</p>`;
  return { subject, bodyHtml: baseTemplate(body, fromName) };
}
