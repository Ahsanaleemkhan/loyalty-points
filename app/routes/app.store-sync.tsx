import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getShopGroup,
  createStoreGroup,
  joinStoreGroup,
  leaveStoreGroup,
  removeMember,
} from "../models/storeSync.server";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const groupInfo = await getShopGroup(session.shop);
  return { shop: session.shop, groupInfo };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  try {
    if (intent === "create") {
      const name = String(fd.get("groupName") || "My Store Group");
      const group = await createStoreGroup(session.shop, name);
      return { success: `Group "${group.name}" created. Share the link code with your other stores.`, linkCode: group.linkCode };
    }

    if (intent === "join") {
      const linkCode = String(fd.get("linkCode") || "").trim();
      if (!linkCode) return { error: "Please enter a link code." };
      await joinStoreGroup(session.shop, linkCode);
      return { success: "Successfully joined the store group! Points are now synced across stores." };
    }

    if (intent === "leave") {
      await leaveStoreGroup(session.shop);
      return { success: "Left the store group. This store's points are now independent." };
    }

    if (intent === "remove") {
      const memberShop = String(fd.get("memberShop") || "");
      await removeMember(session.shop, memberShop);
      return { success: `${memberShop} removed from your group.` };
    }
  } catch (e: any) {
    return { error: e.message || "An error occurred." };
  }

  return { error: "Unknown action." };
};

export default function StoreSync() {
  const { shop, groupInfo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data as any;

  const isOwner  = groupInfo?.role === "owner";
  const isMember = groupInfo?.role === "member";
  const inGroup  = !!groupInfo;

  const TOOLS_TABS = [
    { label: "Widget Builder", to: "/app/widget-builder" },
    { label: "Store Sync",     to: "/app/store-sync" },
    { label: "Sync Orders",    to: "/app/sync-orders" },
  ];

  return (
    <s-page heading="Multi-Store Sync">
      <PageTabs tabs={TOOLS_TABS} />

      {/* Status Banner */}
      {result?.success && (
        <s-section>
          <div style={{ background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "12px 16px", color: "#065f46", fontWeight: "600" }}>
            ✓ {result.success}
          </div>
        </s-section>
      )}
      {result?.error && (
        <s-section>
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "12px 16px", color: "#b91c1c", fontWeight: "600" }}>
            ✕ {result.error}
          </div>
        </s-section>
      )}

      {/* How it works */}
      <s-section heading="How Multi-Store Sync Works">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", marginBottom: "8px" }}>
          {[
            { icon: "🔗", title: "Create a Group", desc: "One store creates the group and gets a Link Code." },
            { icon: "📋", title: "Share Link Code", desc: "Share the code with your other stores. They join with one click." },
            { icon: "🌐", title: "Points are Shared", desc: "Customers earn at Store A and redeem at Store B — by email." },
          ].map((s) => (
            <div key={s.title} style={{ background: "#f6f6f7", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>{s.icon}</div>
              <div style={{ fontWeight: "700", marginBottom: "4px" }}>{s.title}</div>
              <div style={{ fontSize: "12px", color: "#6d7175" }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#92400e" }}>
          <strong>Note:</strong> Sync matches customers by <strong>email address</strong>. Customers must use the same email across stores for points to be combined.
        </div>
      </s-section>

      {/* Current status */}
      {!inGroup ? (
        /* ── Not in a group ── */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>

          <s-section heading="Create a New Group">
            <s-paragraph>You own multiple stores? Create a group and invite the others.</s-paragraph>
            <fetcher.Form method="post" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              <input type="hidden" name="intent" value="create" />
              <div>
                <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "4px" }}>Group Name</label>
                <input name="groupName" className="lp-input" placeholder="e.g. My Brand Stores" defaultValue="My Store Group" style={{ width: "100%" }} />
              </div>
              <button type="submit" className="lp-btn lp-btn-primary">Create Group</button>
            </fetcher.Form>
          </s-section>

          <s-section heading="Join an Existing Group">
            <s-paragraph>Got a Link Code from another store owner? Paste it below to join their group.</s-paragraph>
            <fetcher.Form method="post" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              <input type="hidden" name="intent" value="join" />
              <div>
                <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "4px" }}>Link Code</label>
                <input name="linkCode" className="lp-input" placeholder="Paste link code here" style={{ width: "100%" }} />
              </div>
              <button type="submit" className="lp-btn lp-btn-secondary">Join Group</button>
            </fetcher.Form>
          </s-section>

        </div>
      ) : (
        /* ── In a group ── */
        <s-section heading={isOwner ? `Your Group: ${groupInfo.group.name}` : `Member of: ${groupInfo.group.name}`}>

          {/* Link code (owner only) */}
          {isOwner && (
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "14px 18px", marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", color: "#0369a1", fontWeight: "600", marginBottom: "6px", textTransform: "uppercase" }}>Your Link Code — Share with other stores</div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <code style={{ fontFamily: "monospace", fontSize: "16px", fontWeight: "700", background: "#fff", border: "1px solid #bae6fd", borderRadius: "6px", padding: "8px 14px", letterSpacing: "1px", flex: 1 }}>
                  {groupInfo.group.linkCode}
                </code>
                <button
                  type="button"
                  className="lp-btn lp-btn-secondary lp-btn-sm"
                  onClick={() => navigator.clipboard.writeText(groupInfo.group.linkCode)}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Members list */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "10px", color: "#374151" }}>
              Stores in this group ({groupInfo.group.members.length + 1} total):
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

              {/* Owner row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "10px 14px" }}>
                <div>
                  <span style={{ fontWeight: "700", fontSize: "14px" }}>{groupInfo.group.ownerShop}</span>
                  <span style={{ marginLeft: "8px", fontSize: "11px", background: "#008060", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>Owner</span>
                </div>
                {shop === groupInfo.group.ownerShop && (
                  <span style={{ fontSize: "12px", color: "#6d7175" }}>← You</span>
                )}
              </div>

              {/* Member rows */}
              {groupInfo.group.members.map((m: any) => (
                <div key={m.shop} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 14px" }}>
                  <div>
                    <span style={{ fontWeight: "600", fontSize: "14px" }}>{m.shop}</span>
                    {shop === m.shop && (
                      <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6d7175" }}>← You</span>
                    )}
                  </div>
                  {isOwner && shop !== m.shop && (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="memberShop" value={m.shop} />
                      <button type="submit" className="lp-btn lp-btn-sm" style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px" }}>
                        Remove
                      </button>
                    </fetcher.Form>
                  )}
                </div>
              ))}

              {groupInfo.group.members.length === 0 && (
                <div style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic", padding: "8px 0" }}>
                  No other stores yet. Share your Link Code above to invite them.
                </div>
              )}
            </div>
          </div>

          {/* Points sync info */}
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#92400e", marginBottom: "16px" }}>
            <strong>✓ Points are synced.</strong> Customers earn at any store in this group and their combined balance is visible everywhere.
          </div>

          {/* Leave button */}
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="leave" />
            <button
              type="submit"
              className="lp-btn"
              style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600" }}
              onClick={(e) => { if (!confirm(isOwner ? "This will disband the group and disconnect all stores. Continue?" : "Leave this group?")) e.preventDefault(); }}
            >
              {isOwner ? "⚠️ Disband Group" : "Leave Group"}
            </button>
          </fetcher.Form>

        </s-section>
      )}

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
