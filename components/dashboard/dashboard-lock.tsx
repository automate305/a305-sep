"use client";

import { useActionState } from "react";

import { unlockDashboard, type DashboardUnlockState } from "@/app/actions";

const initialState: DashboardUnlockState = { error: "" };

export function DashboardLock({ configured }: { configured: boolean }) {
  const [state, formAction, isPending] = useActionState(unlockDashboard, initialState);

  return (
    <main className="lock-screen">
      <section className="lock-card" aria-labelledby="lock-title">
        <div className="lock-brand"><span />AUTOMATE<strong>305</strong></div>
        <p className="lock-kicker">PRIVATE OPERATIONS</p>
        <h1 className="outbox-wordmark" id="lock-title">outbox</h1>
        <p>Unlock live campaigns, sender health, approvals, and today&apos;s queue.</p>
        {configured ? (
          <form action={formAction}>
            <label htmlFor="dashboard-key">Dashboard key</label>
            <input
              autoComplete="current-password"
              id="dashboard-key"
              name="dashboardKey"
              placeholder="Enter dashboard key"
              required
              type="password"
            />
            {state.error ? <p className="lock-error" role="alert">{state.error}</p> : null}
            <button disabled={isPending} type="submit">
              {isPending ? "Unlocking…" : "Unlock dashboard"}
            </button>
          </form>
        ) : (
          <div className="lock-configuration" role="status">
            Add <code>DASHBOARD_ACCESS_KEY</code> to the server environment before launch.
          </div>
        )}
      </section>
    </main>
  );
}
