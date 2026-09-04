import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DealMemo, IntakeRequest } from "../../shared/schema.js";

/**
 * Memo archive. Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_KEY are set
 * (same variable names as the rest of a305-sep); otherwise an in-process map,
 * which is fine locally but does not survive Vercel invocations.
 */

export interface RunStats { duration_ms: number; input_tokens: number; output_tokens: number; searches: number }

export interface MemoRecord {
  id?: string;
  token: string;
  business_name: string;
  source: "ui" | "webhook" | "sample";
  intake: IntakeRequest;
  memo: DealMemo;
  stats: RunStats | null;
  delivered_to: string | null;
  created_at: string;
}

const TABLE = "mintiq_memos";
const memory = new Map<string, MemoRecord>();
let _sb: SupabaseClient | null | undefined;

function supabase(): SupabaseClient | null {
  if (_sb !== undefined) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  _sb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return _sb;
}

export function storeMode(): "supabase" | "memory" {
  return supabase() ? "supabase" : "memory";
}

export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Drop base64 file payloads before persisting; keep the names for the record. */
export function stripFiles(intake: IntakeRequest): IntakeRequest {
  return { ...intake, files: (intake.files ?? []).map((f) => ({ name: f.name, media_type: f.media_type, data: "" })) };
}

export async function saveMemo(rec: Omit<MemoRecord, "created_at" | "id">): Promise<MemoRecord> {
  const record: MemoRecord = { ...rec, intake: stripFiles(rec.intake), created_at: new Date().toISOString() };
  const sb = supabase();
  if (!sb) {
    memory.set(record.token, record);
    return record;
  }
  const { data, error } = await sb.from(TABLE).insert({
    token: record.token,
    business_name: record.business_name,
    source: record.source,
    intake: record.intake,
    memo: record.memo,
    stats: record.stats,
    delivered_to: record.delivered_to,
  }).select("id, created_at").single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return { ...record, id: data.id, created_at: data.created_at };
}

export async function markDelivered(token: string, to: string): Promise<void> {
  const sb = supabase();
  if (!sb) {
    const rec = memory.get(token);
    if (rec) rec.delivered_to = to;
    return;
  }
  await sb.from(TABLE).update({ delivered_to: to }).eq("token", token);
}

export async function getMemoByToken(token: string): Promise<MemoRecord | null> {
  const sb = supabase();
  if (!sb) return memory.get(token) ?? null;
  const { data, error } = await sb.from(TABLE).select("*").eq("token", token).maybeSingle();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data as MemoRecord | null) ?? null;
}

export function memoUrl(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/$/, "")}/m/${token}`;
}
