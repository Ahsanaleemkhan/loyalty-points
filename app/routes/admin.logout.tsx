import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { COOKIE_CLEAR } from "../utils/admin-auth.server";

const clearAndRedirect = () =>
  redirect("/admin/login", {
    headers: { "Set-Cookie": COOKIE_CLEAR },
  });

export const action  = async (_: ActionFunctionArgs) => clearAndRedirect();
export const loader  = async (_: LoaderFunctionArgs) => clearAndRedirect();
