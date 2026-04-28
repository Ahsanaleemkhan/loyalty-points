/**
 * Format a number as a currency string using the Intl API.
 * Falls back to prefixing the raw symbol if the currency code is unknown.
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Returns just the currency symbol for a given currency code.
 * e.g. "USD" → "$", "EUR" → "€", "GBP" → "£"
 */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** All commonly supported ISO 4217 currency codes with display labels */
export const CURRENCY_OPTIONS = [
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "CAD", label: "CAD — Canadian Dollar (CA$)" },
  { code: "AUD", label: "AUD — Australian Dollar (A$)" },
  { code: "NZD", label: "NZD — New Zealand Dollar (NZ$)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
  { code: "CNY", label: "CNY — Chinese Yuan (¥)" },
  { code: "HKD", label: "HKD — Hong Kong Dollar (HK$)" },
  { code: "SGD", label: "SGD — Singapore Dollar (S$)" },
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "AED", label: "AED — UAE Dirham (د.إ)" },
  { code: "SAR", label: "SAR — Saudi Riyal (﷼)" },
  { code: "CHF", label: "CHF — Swiss Franc (CHF)" },
  { code: "SEK", label: "SEK — Swedish Krona (kr)" },
  { code: "NOK", label: "NOK — Norwegian Krone (kr)" },
  { code: "DKK", label: "DKK — Danish Krone (kr)" },
  { code: "MXN", label: "MXN — Mexican Peso (MX$)" },
  { code: "BRL", label: "BRL — Brazilian Real (R$)" },
  { code: "ZAR", label: "ZAR — South African Rand (R)" },
  { code: "PKR", label: "PKR — Pakistani Rupee (₨)" },
  { code: "BDT", label: "BDT — Bangladeshi Taka (৳)" },
  { code: "IDR", label: "IDR — Indonesian Rupiah (Rp)" },
  { code: "MYR", label: "MYR — Malaysian Ringgit (RM)" },
  { code: "THB", label: "THB — Thai Baht (฿)" },
  { code: "PHP", label: "PHP — Philippine Peso (₱)" },
  { code: "KRW", label: "KRW — South Korean Won (₩)" },
  { code: "TRY", label: "TRY — Turkish Lira (₺)" },
  { code: "PLN", label: "PLN — Polish Zloty (zł)" },
  { code: "CZK", label: "CZK — Czech Koruna (Kč)" },
  { code: "HUF", label: "HUF — Hungarian Forint (Ft)" },
  { code: "RON", label: "RON — Romanian Leu (lei)" },
  { code: "ILS", label: "ILS — Israeli Shekel (₪)" },
  { code: "NGN", label: "NGN — Nigerian Naira (₦)" },
  { code: "KES", label: "KES — Kenyan Shilling (KSh)" },
  { code: "GHS", label: "GHS — Ghanaian Cedi (GH₵)" },
  { code: "EGP", label: "EGP — Egyptian Pound (E£)" },
  { code: "MAD", label: "MAD — Moroccan Dirham (MAD)" },
  { code: "CLP", label: "CLP — Chilean Peso (CLP$)" },
  { code: "COP", label: "COP — Colombian Peso (COP$)" },
  { code: "ARS", label: "ARS — Argentine Peso (ARS$)" },
  { code: "PEN", label: "PEN — Peruvian Sol (S/)" },
  { code: "VND", label: "VND — Vietnamese Dong (₫)" },
  { code: "UAH", label: "UAH — Ukrainian Hryvnia (₴)" },
];
