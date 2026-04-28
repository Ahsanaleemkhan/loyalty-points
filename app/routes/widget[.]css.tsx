/**
 * Serves the loyalty widget CSS from the app server.
 * URL: /widget.css
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // eslint-disable-next-line no-undef
    const filePath = join(process.cwd(), "extensions", "loyalty-widget", "assets", "loyalty-widget.css");
    const content = readFileSync(filePath, "utf-8");

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response("/* Widget CSS not found */", {
      status: 404,
      headers: { "Content-Type": "text/css" },
    });
  }
};
