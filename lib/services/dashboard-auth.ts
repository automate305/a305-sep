import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { isUsableEnvironmentValue } from "@/lib/services/smtp.js";

const DASHBOARD_COOKIE_NAME = "a305_dashboard_session";
const DASHBOARD_SESSION_PURPOSE = "a305-dashboard-session-v1";

function getDashboardAccessKey(): string | null {
  const accessKey = process.env.DASHBOARD_ACCESS_KEY || "";
  return isUsableEnvironmentValue(accessKey) ? accessKey : null;
}

function hashValue(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function getSessionToken(accessKey: string): string {
  return createHmac("sha256", accessKey)
    .update(DASHBOARD_SESSION_PURPOSE)
    .digest("hex");
}

export function dashboardAccessIsConfigured(): boolean {
  return getDashboardAccessKey() !== null;
}

export function dashboardKeyIsValid(providedKey: string): boolean {
  const accessKey = getDashboardAccessKey();
  if (!accessKey) return false;
  return timingSafeEqual(hashValue(providedKey), hashValue(accessKey));
}

export async function hasDashboardAccess(): Promise<boolean> {
  const accessKey = getDashboardAccessKey();
  if (!accessKey) return false;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;
  if (!sessionCookie) return false;
  return timingSafeEqual(hashValue(sessionCookie), hashValue(getSessionToken(accessKey)));
}

export async function setDashboardSession(): Promise<void> {
  const accessKey = getDashboardAccessKey();
  if (!accessKey) throw new Error("Dashboard access is not configured");
  const cookieStore = await cookies();
  cookieStore.set(DASHBOARD_COOKIE_NAME, getSessionToken(accessKey), {
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearDashboardSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(DASHBOARD_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
