import type { ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import prisma from "../db.server";
import adminPortalCss from "../styles/admin-portal.css?url";

export const links = () => [{ rel: "stylesheet", href: adminPortalCss }];

const DEFAULT_PROMPT = `You are a friendly loyalty rewards assistant. Help customers with:
- Their current points balance and tier status
- How to earn more points on purchases
- How to redeem points for discount codes
- Questions about their transaction history

Keep responses brief (2-3 sentences max). Be warm and encouraging.
Never make up information not provided in the customer context.`;

async function getOrCreateSettings() {
  return prisma.adminSettings.upsert({
    where:  { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

export const loader = async () => {
  const settings   = await getOrCreateSettings();
  const apiKey     = process.env.ANTHROPIC_API_KEY ?? "";
  const apiKeySet  = apiKey.length > 10;
  const apiKeyMask = apiKeySet ? `sk-ant-...${apiKey.slice(-4)}` : "Not configured";
  return { settings, apiKeySet, apiKeyMask };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  await prisma.adminSettings.upsert({
    where:  { id: "singleton" },
    update: {
      chatbotEnabled:      form.get("chatbotEnabled") === "true",
      claudeModel:         String(form.get("claudeModel") || "claude-sonnet-4-5"),
      chatbotSystemPrompt: String(form.get("chatbotSystemPrompt") || ""),
    },
    create: {
      id:                  "singleton",
      chatbotEnabled:      form.get("chatbotEnabled") === "true",
      claudeModel:         String(form.get("claudeModel") || "claude-sonnet-4-5"),
      chatbotSystemPrompt: String(form.get("chatbotSystemPrompt") || ""),
    },
  });
  return { success: "Settings saved." };
};

const MODELS = [
  { value: "claude-opus-4-5",   label: "Claude Opus 4.5 — Most capable, slower" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 — Recommended (speed + quality)" },
  { value: "claude-haiku-4-5",  label: "Claude Haiku 4.5 — Fastest, lowest cost" },
];

export default function AdminSettings() {
  const { settings, apiKeySet, apiKeyMask } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saved   = fetcher.data?.success;

  return (
    <>
      <div className="ap-page-title">AI & Settings</div>

      {/* API Key status */}
      <div className="ap-card">
        <div className="ap-section-title">Anthropic API Key</div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "#0f172a", borderRadius: "8px", padding: "14px 16px" }}>
          <span style={{ fontSize: "22px" }}>{apiKeySet ? "✅" : "❌"}</span>
          <div>
            <div style={{ fontWeight: 600, color: "#f1f5f9", fontSize: "14px" }}>
              {apiKeySet ? "API Key Configured" : "API Key Not Set"}
            </div>
            <div style={{ color: "#64748b", fontSize: "12px", marginTop: "2px", fontFamily: "monospace" }}>
              {apiKeyMask}
            </div>
          </div>
        </div>
        {!apiKeySet && (
          <div className="ap-warn">
            ⚠️ Add <code style={{ background: "#0f172a", padding: "1px 6px", borderRadius: "4px" }}>ANTHROPIC_API_KEY=sk-ant-...</code> to your server <code>.env</code> file, then restart the app.
            Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: "#fcd34d" }}>console.anthropic.com</a>
          </div>
        )}
      </div>

      {/* Chatbot settings */}
      <div className="ap-card">
        <div className="ap-section-title">Chatbot Configuration</div>
        {saved && <div className="ap-success">✓ {saved}</div>}

        <fetcher.Form method="post">
          <div className="ap-field">
            <label>Chatbot Status</label>
            <select name="chatbotEnabled" defaultValue={settings.chatbotEnabled ? "true" : "false"}>
              <option value="true">✅ Enabled — Chat tab visible in storefront widget</option>
              <option value="false">❌ Disabled — Chat tab hidden from all stores</option>
            </select>
          </div>

          <div className="ap-field">
            <label>Claude Model</label>
            <select name="claudeModel" defaultValue={settings.claudeModel}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="ap-field">
            <label>System Prompt</label>
            <textarea
              name="chatbotSystemPrompt"
              rows={9}
              defaultValue={settings.chatbotSystemPrompt || DEFAULT_PROMPT}
              style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: "1.6" }}
            />
            <div className="ap-field-hint">
              The AI automatically receives each customer's live data (balance, tier, recent transactions). You only need to set the persona and tone here.
            </div>
          </div>

          <button
            className="ap-btn"
            type="submit"
            disabled={fetcher.state === "submitting"}
          >
            {fetcher.state === "submitting" ? "Saving…" : "Save Settings"}
          </button>
        </fetcher.Form>
      </div>

      {/* Cost info */}
      <div className="ap-card">
        <div className="ap-section-title">Estimated API Cost</div>
        <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: "1.8" }}>
          <p>Each customer message costs approximately:</p>
          <ul style={{ margin: "8px 0 0 20px" }}>
            <li><strong style={{ color: "#f1f5f9" }}>Haiku 4.5</strong> — ~$0.0001 per message (cheapest)</li>
            <li><strong style={{ color: "#f1f5f9" }}>Sonnet 4.5</strong> — ~$0.001 per message (recommended)</li>
            <li><strong style={{ color: "#f1f5f9" }}>Opus 4.5</strong> — ~$0.01 per message (most capable)</li>
          </ul>
          <p style={{ marginTop: "8px" }}>Rate limit: 15 messages per customer per hour is enforced automatically.</p>
        </div>
      </div>
    </>
  );
}
