import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSubmission, approveSubmission, rejectSubmission } from "../models/submissions.server";
import { getSettings, calculatePoints } from "../models/settings.server";
import { awardPoints } from "../models/points.server";
import { formatMoney } from "../utils/currency";
import { sendEmail, submissionApprovedEmail, submissionRejectedEmail } from "../utils/email.server";
import { getCustomerPointsBalance } from "../models/transactions.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const submission = await getSubmission(params.id!);
  if (!submission || submission.shop !== session.shop) {
    throw new Response("Not Found", { status: 404 });
  }
  const settings = await getSettings(session.shop);
  const suggestedPoints = calculatePoints(submission.purchaseAmount, settings);
  return { submission, suggestedPoints, currency: settings.currency };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const adminNotes = String(formData.get("adminNotes") || "");
  const submission = await getSubmission(params.id!);

  if (!submission || submission.shop !== session.shop) {
    return { error: "Submission not found" };
  }

  const settings = await getSettings(session.shop);

  if (intent === "approve") {
    const pointsAwarded = Number(formData.get("pointsAwarded"));
    await approveSubmission(params.id!, pointsAwarded, adminNotes);
    if (pointsAwarded > 0) {
      await awardPoints({
        shop: session.shop,
        customerId: submission.customerId,
        customerEmail: submission.customerEmail,
        customerName: submission.customerName,
        points: pointsAwarded,
        type: "EARNED_PHYSICAL",
        submissionId: params.id,
        note: `Physical receipt approved — ${submission.storeLocation || "store"}`,
        admin,
      });
    }
    // Send approval email
    if (settings.emailEnabled) {
      const newBalance = await getCustomerPointsBalance(session.shop, submission.customerId);
      const { subject, bodyHtml } = submissionApprovedEmail({
        customerName: submission.customerName,
        points: pointsAwarded,
        currency: settings.currency,
        balance: newBalance,
        fromName: settings.emailFromName,
      });
      await sendEmail(admin, { to: submission.customerEmail, customerName: submission.customerName, subject, bodyHtml, fromName: settings.emailFromName }).catch(() => {});
    }
    return { success: "Submission approved and points awarded" };
  }

  if (intent === "reject") {
    await rejectSubmission(params.id!, adminNotes);
    // Send rejection email
    if (settings.emailEnabled) {
      const { subject, bodyHtml } = submissionRejectedEmail({
        customerName: submission.customerName,
        adminNotes,
        fromName: settings.emailFromName,
      });
      await sendEmail(admin, { to: submission.customerEmail, customerName: submission.customerName, subject, bodyHtml, fromName: settings.emailFromName }).catch(() => {});
    }
    return { success: "Submission rejected" };
  }

  return { error: "Unknown action" };
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
  borderRadius: "4px", fontSize: "14px", boxSizing: "border-box",
};

export default function SubmissionReview() {
  const { submission, suggestedPoints, currency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const isReviewed = submission.status !== "PENDING";
  const statusColor: Record<string, string> = {
    PENDING: "#d97706", APPROVED: "#008060", REJECTED: "#c0392b",
  };

  return (
    <s-page heading="Review Submission">
      <s-button slot="primary-action" onClick={() => navigate("/app/submissions")} variant="secondary">
        Back to Submissions
      </s-button>

      {fetcher.data && "success" in fetcher.data && (
        <s-section>
          <div style={{ background: "#d1fae5", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#065f46", fontWeight: "600" }}>
            {(fetcher.data as { success: string }).success}
          </div>
        </s-section>
      )}

      <s-section heading="Customer">
        <s-stack direction="block" gap="base">
          <s-paragraph><strong>Name:</strong> {submission.customerName || "—"}</s-paragraph>
          <s-paragraph><strong>Email:</strong> {submission.customerEmail}</s-paragraph>
          <s-paragraph><strong>Customer ID:</strong> {submission.customerId}</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Purchase Details">
        <s-stack direction="block" gap="base">
          <s-paragraph><strong>Amount:</strong> {formatMoney(submission.purchaseAmount, currency)}</s-paragraph>
          <s-paragraph><strong>Purchase Date:</strong> {submission.purchaseDate}</s-paragraph>
          <s-paragraph><strong>Store Location:</strong> {submission.storeLocation || "—"}</s-paragraph>
          <s-paragraph><strong>Notes:</strong> {submission.notes || "—"}</s-paragraph>
          <s-paragraph><strong>Submitted:</strong> {new Date(submission.createdAt).toLocaleString()}</s-paragraph>
          <s-paragraph>
            <strong>Status:</strong>{" "}
            <span style={{ color: statusColor[submission.status] ?? "#202223", fontWeight: "700" }}>
              {submission.status}
            </span>
          </s-paragraph>
          {submission.status === "APPROVED" && (
            <s-paragraph><strong>Points Awarded:</strong> {submission.pointsAwarded}</s-paragraph>
          )}
          {submission.adminNotes && (
            <s-paragraph><strong>Admin Notes:</strong> {submission.adminNotes}</s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Receipt">
        {submission.receiptType.startsWith("image/") ? (
          <img
            src={submission.receiptData}
            alt="Receipt"
            style={{ maxWidth: "100%", maxHeight: "500px", border: "1px solid #e1e3e5", borderRadius: "6px" }}
          />
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>PDF: <strong>{submission.receiptName}</strong> ({(submission.receiptSize / 1024).toFixed(1)} KB)</s-paragraph>
            <a href={submission.receiptData} download={submission.receiptName} style={{ color: "#008060", fontWeight: "500" }}>
              Download Receipt
            </a>
          </s-stack>
        )}
      </s-section>

      {!isReviewed && (
        <s-section heading="Review Decision">
          <fetcher.Form method="post">
            <s-stack direction="block" gap="base">
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: "500" }}>
                  Points to Award (suggested: {suggestedPoints})
                </label>
                <input name="pointsAwarded" type="number" min="0" defaultValue={suggestedPoints} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: "500" }}>
                  Admin Notes (optional)
                </label>
                <textarea name="adminNotes" rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="Reason for approval/rejection..." />
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  type="submit"
                  name="intent"
                  value="approve"
                  disabled={fetcher.state !== "idle"}
                  style={{
                    padding: "10px 24px",
                    background: fetcher.state !== "idle" ? "#9ca3af" : "#008060",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: fetcher.state !== "idle" ? "not-allowed" : "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                  }}
                >
                  {fetcher.state !== "idle" ? "⏳ Processing…" : "Approve and Award Points"}
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="reject"
                  disabled={fetcher.state !== "idle"}
                  style={{
                    padding: "10px 24px",
                    background: "#fee2e2",
                    color: "#b91c1c",
                    border: "1px solid #b91c1c",
                    borderRadius: "6px",
                    cursor: fetcher.state !== "idle" ? "not-allowed" : "pointer",
                    fontWeight: "600",
                    fontSize: "14px",
                    opacity: fetcher.state !== "idle" ? 0.6 : 1,
                  }}
                >
                  Reject
                </button>
              </div>
            </s-stack>
          </fetcher.Form>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
