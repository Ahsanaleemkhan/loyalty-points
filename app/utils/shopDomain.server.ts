import { readFile } from "node:fs/promises";
import path from "node:path";

export function normalizeShopDomain(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const domain = trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain.endsWith(".myshopify.com")) return null;

  return domain;
}

async function readShopFromLocalProjectFile(): Promise<string | null> {
  try {
    const projectPath = path.resolve(process.cwd(), ".shopify", "project.json");
    const raw = await readFile(projectPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { dev_store_url?: string }>;

    for (const entry of Object.values(parsed)) {
      const normalized = normalizeShopDomain(entry?.dev_store_url);
      if (normalized) return normalized;
    }
  } catch {
    // Ignore local project file errors; this file does not exist in production.
  }

  return null;
}

export async function getPreferredShopDomain(request: Request): Promise<string | null> {
  const url = new URL(request.url);

  const queryShop = normalizeShopDomain(url.searchParams.get("shop"));
  if (queryShop) return queryShop;

  const headerShop = normalizeShopDomain(request.headers.get("x-shopify-shop-domain"));
  if (headerShop) return headerShop;

  const envCandidates = [
    process.env.SHOPIFY_SHOP,
    process.env.SHOPIFY_DEV_STORE,
    process.env.SHOPIFY_DEV_STORE_URL,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeShopDomain(candidate);
    if (normalized) return normalized;
  }

  return readShopFromLocalProjectFile();
}
