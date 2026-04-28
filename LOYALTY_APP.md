# Loyalty Points App — Setup & Developer Guide

## Overview

A complete Shopify loyalty points system with:
- **Automatic points** awarded on every paid order
- **Admin dashboard** with stats, settings, and customer management
- **Physical receipt submissions** via an embeddable theme widget
- **Admin review queue** for approving/rejecting physical receipts
- **Customer metafield sync** so points display in Liquid themes

---

## Architecture

```
app/
  models/
    settings.server.ts      — App settings (conversion rate, etc.)
    points.server.ts        — Award points + sync to Shopify metafields
    transactions.server.ts  — Points transaction history & balance
    submissions.server.ts   — Physical receipt submission CRUD
  routes/
    app._index.tsx          — Dashboard with stats
    app.settings.tsx        — Admin settings page
    app.submissions.tsx     — Submissions list (filter by status)
    app.submissions.$id.tsx — Review individual submission
    app.customers.tsx       — Customer points management + manual adjust
    app.transactions.tsx    — Full transaction history
    webhooks.orders.paid.tsx — Auto-award points on order completion
    api.widget.tsx          — Public API for the theme extension widget

extensions/
  loyalty-widget/
    blocks/loyalty-widget.liquid — Theme app extension block
    assets/loyalty-widget.js    — Widget JavaScript
    assets/loyalty-widget.css   — Widget styles

prisma/
  schema.prisma             — AppSettings, PointsTransaction, PhysicalSubmission models
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run database migrations
```bash
npx prisma migrate dev
```

### 3. Start development server
```bash
npm run dev
```

### 4. Configure the app in Shopify Partners
- Set your app URL in `shopify.app.toml`
- Run `shopify app deploy` to register webhooks

---

## Admin Interface

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/app` | Stats overview + quick actions |
| Settings | `/app/settings` | Configure points conversion rate |
| Submissions | `/app/submissions` | Review physical receipt submissions |
| Customers | `/app/customers` | View balances + manual adjust |
| Transactions | `/app/transactions` | Full audit log |
| Billing | `/app/billing` | Plan selection, upgrades/downgrades, cancellation |

---

## Billing Plans (Shopify App Store)

The app now uses Shopify's App Subscription Billing API with three recurring plans:

| Plan | Price | Trial | Billing Interval |
|------|-------|-------|------------------|
| Starter | $9 USD | 14 days | Every 30 days |
| Growth | $29 USD | 14 days | Every 30 days |
| Scale | $79 USD | 14 days | Every 30 days |

Implementation details:
- Billing config is defined in `app/billing/plans.ts`
- Enforced for all embedded admin routes in `app/routes/app.tsx`
- Plan selection and subscription management page at `/app/billing`
- Plan changes use immediate replacement behavior
- Merchants can cancel active subscriptions from the billing page

Important behavior:
- Billing is checked on every `/app/*` route except `/app/billing`
- If no active plan exists, merchant is redirected to `/app/billing`
- During development, billing runs in test mode by default

---

## Points System

### Conversion Rate (configurable)
Default: **10 points per $100 spent**

Formula: `points = floor(orderTotal × (pointsPerAmount / amountPerPoints))`

Example with defaults: $150 order → `floor(150 × 0.1)` = **15 points**

### Transaction Types
| Type | Description |
|------|-------------|
| `EARNED_ONLINE` | Auto-awarded on paid Shopify orders |
| `EARNED_PHYSICAL` | Admin-approved physical receipt |
| `MANUAL_ADJUST` | Admin manually added/removed points |
| `REDEEMED` | Points spent (for future redemption feature) |
| `EXPIRED` | Points that expired (for future expiry job) |

### Customer Metafield
Points balance is synced to:
- **Namespace:** `loyalty`
- **Key:** `points_balance`
- **Type:** `number_integer`

Use in Liquid: `{{ customer.metafields.loyalty.points_balance }}`

---

## Theme Widget

### Installation
1. In the Shopify admin, go to **Online Store → Themes → Customize**
2. Add an **App Block** section to any page
3. Select **Loyalty Points Widget**
4. Enter your **App URL** in the block settings
5. Customize heading, subheading, and colors

### Widget Features
- Displays customer's current points balance
- Shows recent submission history with status badges
- File upload with drag-and-drop (JPG, PNG, WebP, PDF — max 5MB)
- Real-time form validation
- Mobile responsive

### Widget Settings
| Setting | Default |
|---------|---------|
| App URL | *(required)* |
| Heading | "Earn Loyalty Points" |
| Subheading | "Upload a receipt to earn points" |
| Button Label | "Submit Receipt" |
| Primary Color | #008060 |

---

## User Flows

### Flow 1: Online Purchase (Automatic)
1. Customer completes checkout
2. Shopify sends `orders/paid` webhook
3. App calculates points based on order total
4. Points transaction recorded in DB
5. Customer metafield updated with new balance

### Flow 2: Physical Receipt
1. Customer fills out widget form + uploads receipt
2. Submission stored as `PENDING` in database
3. Admin reviews in `/app/submissions`
4. On approval: points awarded + customer metafield updated
5. On rejection: submission marked as REJECTED

### Flow 3: Manual Adjustment
1. Admin opens `/app/customers`
2. Finds customer, enters +/- point delta and reason
3. Transaction recorded, metafield updated immediately

---

## API Endpoint (Widget)

### GET `/api/widget?shop=...&customerId=...`
Returns customer's points balance and recent submissions.

```json
{
  "balance": 150,
  "submissions": [
    { "id": "...", "status": "APPROVED", "purchaseAmount": 75.00, "pointsAwarded": 7, ... }
  ]
}
```

### POST `/api/widget`
Submit a physical receipt.

```json
{
  "shop": "mystore.myshopify.com",
  "customerId": "gid://shopify/Customer/123",
  "customerEmail": "customer@example.com",
  "customerName": "Jane Doe",
  "receiptData": "data:image/jpeg;base64,...",
  "receiptName": "receipt.jpg",
  "receiptType": "image/jpeg",
  "receiptSize": 204800,
  "purchaseAmount": 85.00,
  "purchaseDate": "2026-04-04",
  "storeLocation": "Main Street Store",
  "notes": "Optional notes"
}
```

**Rate limit:** Max 3 pending submissions per customer at a time.

---

## Production Checklist

- [ ] Replace SQLite with PostgreSQL in `prisma/schema.prisma`
- [ ] Move receipt storage from base64 in DB to **AWS S3** or **Shopify Files API**
- [ ] Set up email notifications (Shopify Email or SendGrid) on approval/rejection
- [ ] Implement points expiry cron job using `pointsExpiryDays` setting
- [ ] Add redemption flow (apply points as discount codes)
- [ ] Configure rate limiting middleware
- [ ] Set `SHOPIFY_APP_URL` in production environment variables

---

## Environment Variables

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_URL=https://your-app.fly.dev
SHOPIFY_BILLING_TEST_MODE=true
SCOPES=write_products,write_metaobjects,write_metaobject_definitions,read_orders,read_customers,write_customers,read_metafields,write_metafields
```

`SHOPIFY_BILLING_TEST_MODE` notes:
- `true`: creates test subscriptions (safe for development)
- `false`: creates real billable subscriptions (required for production)

---

## Database Schema

### `AppSettings`
One record per shop. Stores all configurable options.

### `PointsTransaction`
Immutable ledger. Balance = SUM of all transactions for a customer.

### `PhysicalSubmission`
Receipt submissions. Status: `PENDING → APPROVED | REJECTED`.
