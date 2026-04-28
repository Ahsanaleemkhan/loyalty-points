import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { getPreferredShopDomain } from "../../utils/shopDomain.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const shop = await getPreferredShopDomain(request);
  if (shop) {
    throw redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Loyalty Points &amp; Rewards</h1>
        <p className={styles.text}>
          Reward your customers with points on every purchase. Let them redeem
          points for discount codes, unlock VIP tiers, submit physical receipts,
          and refer friends — all from a beautiful storefront widget.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-store.myshopify.com"
              />
            </label>
            <button className={styles.button} type="submit">
              Install App
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          <li>
            <strong>Automatic points on every order.</strong> Points are awarded
            instantly when a customer completes a paid order — no setup required.
          </li>
          <li>
            <strong>Discount code redemptions.</strong> Customers convert their
            points into Shopify discount codes directly from the storefront widget.
          </li>
          <li>
            <strong>VIP tiers &amp; earning rules.</strong> Reward loyal customers
            with multiplied points, first-purchase bonuses, birthday rewards, and
            referral incentives.
          </li>
          <li>
            <strong>Physical receipt submissions.</strong> Let customers upload
            receipts from in-store purchases to earn points — you review and
            approve from the admin.
          </li>
          <li>
            <strong>Multi-store sync.</strong> Connect multiple Shopify stores so
            customers share one unified points balance across your whole brand.
          </li>
        </ul>
      </div>
    </div>
  );
}
