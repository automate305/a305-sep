"use client";

// QuoteMend "Revenue Rescue" dashboard — adapted from the QuoteMend UI
// build. All data arrives as props from the server component (real
// Supabase read models); this file contains no data access and no
// secrets. Interactions are read-only in V1: filtering, reviewing the
// actual outgoing email for each queued follow-up, and browsing
// activity. Sending stays owned by /api/send.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, QueueItem } from "@/lib/dashboard-data";

type EstimateFilter = "All" | QueueItem["priority"];

type IconName = "arrow" | "bell" | "command" | "estimates" | "messages" | "wins";

const iconPaths: Record<IconName, string> = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  command: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  estimates: "M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2Zm2 5h8M8 12h8M8 16h5",
  messages:
    "M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5.1A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v7Z",
  wins: "M4 18 10 12l4 4 7-9M16 7h5v5",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" className="ui-icon" fill="none" viewBox="0 0 24 24">
      <path
        d={iconPaths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const ACTIVITY_MARK: Record<string, { cls: string; glyph: string }> = {
  replied: { cls: "reply", glyph: "↩" },
  sent: { cls: "sent", glyph: "→" },
  bounced: { cls: "sent", glyph: "!" },
  failed: { cls: "sent", glyph: "!" },
};

export function RevenueRescueDashboard({
  dashboardDate,
  data,
}: {
  dashboardDate: string;
  data: DashboardData;
}) {
  const [activeFilter, setActiveFilter] = useState<EstimateFilter>("All");
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const replyCloseButtonRef = useRef<HTMLButtonElement>(null);
  const reviewCloseButtonRef = useRef<HTMLButtonElement>(null);

  const visibleQueue = useMemo(
    () =>
      data.queue.filter(
        (item) =>
          (activeFilter === "All" || item.priority === activeFilter) &&
          !reviewedIds.includes(item.enrollmentId)
      ),
    [activeFilter, data.queue, reviewedIds]
  );

  useEffect(() => {
    if (!selected && !isActivityOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (selected) reviewCloseButtonRef.current?.focus();
    else replyCloseButtonRef.current?.focus();
    function closeOverlay(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(null);
        setIsActivityOpen(false);
      }
    }
    window.addEventListener("keydown", closeOverlay);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOverlay);
    };
  }, [isActivityOpen, selected]);

  function markReviewed(item: QueueItem) {
    setReviewedIds((ids) => [...ids, item.enrollmentId]);
    setSelected(null);
    setNotice(`Reviewed — ${item.name} stays queued for today's send`);
    window.setTimeout(() => setNotice(""), 2800);
  }

  const { autopilot, totals, senders } = data;
  const replyRate =
    totals.total > 0 ? Math.round((totals.replied / totals.total) * 100) : 0;
  const topSender = senders[0];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">Q</span>
          <span>quotemend</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a aria-current="page" className="nav-link active" href="#command-center">
            <span className="nav-icon"><Icon name="command" /></span>
            <span className="nav-label">Command center</span>
          </a>
          <a className="nav-link" href="#estimates">
            <span className="nav-icon"><Icon name="estimates" /></span>
            <span className="nav-label">Today’s queue</span>
            <span className="nav-count">{data.queue.length}</span>
          </a>
          <button
            className="nav-link"
            onClick={() => setIsActivityOpen(true)}
            type="button"
          >
            <span className="nav-icon"><Icon name="messages" /></span>
            <span className="nav-label">Activity</span>
            {autopilot.repliesLast24h > 0 && <span className="nav-dot" />}
          </button>
          <a className="nav-link" href="#wins">
            <span className="nav-icon"><Icon name="wins" /></span>
            <span className="nav-label">Replied wins</span>
          </a>
        </nav>
        <div className="sidebar-section">
          <p className="section-label">CONNECTED SOURCE</p>
          <div className="integration-card">
            <span className="integration-logo">SB</span>
            <span>
              <strong>Supabase</strong>
              <small>
                <i />{" "}
                {data.configured ? "Live · service role" : "Not configured"}
              </small>
            </span>
            <button
              aria-label="Check data connection"
              onClick={() =>
                setNotice(
                  data.configured
                    ? "Supabase is connected — data is live"
                    : "Set SUPABASE_URL and SUPABASE_SERVICE_KEY to go live"
                )
              }
              type="button"
            >
              •••
            </button>
          </div>
        </div>
        <div className="sidebar-footer">
          <button className="nav-link account-row" type="button">
            <span className="avatar dark">A3</span>
            <span>
              <strong>Automate305 SEP</strong>
              <small>Owner workspace</small>
            </span>
            <span className="account-chevron">⌄</span>
          </button>
        </div>
      </aside>

      <section className="workspace" id="command-center">
        <header className="topbar">
          <div>
            <p className="eyebrow">{dashboardDate}</p>
            <h1>Good morning, Camilo.</h1>
            <p>Here’s the outreach that needs your attention today.</p>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Open activity"
              onClick={() => setIsActivityOpen(true)}
              type="button"
            >
              <Icon name="bell" />
              {autopilot.repliesLast24h > 0 && <span />}
            </button>
            <button
              className="primary-button"
              onClick={() => setIsActivityOpen(true)}
              type="button"
            >
              <span className="button-label-full">
                {autopilot.repliesLast24h > 0
                  ? `Review ${autopilot.repliesLast24h} ${autopilot.repliesLast24h === 1 ? "reply" : "replies"}`
                  : "View activity"}
              </span>
              <span className="button-label-short">
                {autopilot.repliesLast24h > 0
                  ? `${autopilot.repliesLast24h} replies`
                  : "Activity"}
              </span>
              <Icon name="arrow" />
            </button>
          </div>
        </header>

        {!data.configured && (
          <div className="revenue-banner">
            <div>
              <p className="eyebrow">SETUP REQUIRED</p>
              <div className="revenue-value">Connect Supabase</div>
              <p className="summary-copy">
                Set <strong>SUPABASE_URL</strong> and{" "}
                <strong>SUPABASE_SERVICE_KEY</strong> (server-side env), then
                reload. The API routes and this dashboard share the same
                configuration — check <strong>/api/health</strong> to verify.
              </p>
            </div>
          </div>
        )}

        {data.configured && (
          <div className="content-grid">
            <section className="main-column">
              <div className="revenue-banner">
                <div>
                  <p className="eyebrow">ACTIVE PIPELINE</p>
                  <div className="revenue-value">
                    {totals.active}{" "}
                    <span>
                      active {totals.active === 1 ? "enrollment" : "enrollments"}
                    </span>
                  </div>
                  <p className="summary-copy">
                    {totals.replied} replied · {totals.completed} completed ·{" "}
                    <strong>{totals.total}</strong> total enrolled
                  </p>
                </div>
                <div
                  className="pipeline-visual"
                  aria-label={`${replyRate} percent of enrollments have replied`}
                >
                  <div className="pipeline-stacks" aria-hidden="true">
                    <span /><span /><span /><span /><span />
                  </div>
                  <div className="pipeline-label">
                    <strong>{replyRate}%</strong>
                    <span>reply rate</span>
                  </div>
                </div>
              </div>

              <div className="queue-header" id="estimates">
                <div>
                  <h2>Today’s follow-up queue</h2>
                  <p>
                    Ranked by urgency — what /api/send will work through on the
                    next trigger.
                  </p>
                </div>
                <div className="filter-group" aria-label="Filter queue" role="group">
                  {(["All", "Hot", "Warm", "Watch"] as EstimateFilter[]).map(
                    (filter) => (
                      <button
                        aria-pressed={activeFilter === filter}
                        className={activeFilter === filter ? "active" : ""}
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        type="button"
                      >
                        {filter}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="estimate-list">
                {visibleQueue.map((item) => (
                  <article className="estimate-card" key={item.enrollmentId}>
                    <div className={`avatar ${item.accent}`}>{item.initials}</div>
                    <div className="estimate-main">
                      <div className="estimate-title-row">
                        <h3>{item.name}</h3>
                        <span className={`priority ${item.priority.toLowerCase()}`}>
                          {item.priority}
                        </span>
                      </div>
                      <p>
                        {item.company} · {item.sequenceName}
                      </p>
                      <span className="buying-signal">↗ {item.signal}</span>
                    </div>
                    <div className="estimate-value">
                      <strong>Step {item.step}</strong>
                      <span>{item.campaign} campaign</span>
                    </div>
                    <button
                      className="approve-button"
                      onClick={() => setSelected(item)}
                      type="button"
                    >
                      Review follow-up <Icon name="arrow" />
                    </button>
                  </article>
                ))}
                {visibleQueue.length === 0 && (
                  <div className="empty-state">
                    <span>✓</span>
                    <h3>This queue is clear.</h3>
                    <p>QuoteMend will keep watching for the next opportunity.</p>
                  </div>
                )}
              </div>
            </section>

            <aside className="insights-column">
              <section className="autopilot-card">
                <div className="card-heading-row">
                  <span className="autopilot-icon">✦</span>
                  <div>
                    <h2>Autopilot — last 24 hours</h2>
                    <p>While you were off the clock</p>
                  </div>
                  <span className="live-pill">LIVE</span>
                </div>
                <div className="autopilot-stats">
                  <div>
                    <strong>{autopilot.sentLast24h}</strong>
                    <span>follow-ups sent</span>
                  </div>
                  <div>
                    <strong>{autopilot.repliesLast24h}</strong>
                    <span>customers replied</span>
                  </div>
                  <div className="booked">
                    <strong>{totals.replied}</strong>
                    <span>total replies</span>
                  </div>
                </div>
                <div className="activity-feed">
                  {autopilot.feed.slice(0, 3).map((a, i) => {
                    const mark = ACTIVITY_MARK[a.kind] ?? ACTIVITY_MARK.sent;
                    return (
                      <div className="activity-item" key={i}>
                        <span className={`activity-mark ${mark.cls}`}>
                          {mark.glyph}
                        </span>
                        <div>
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                        </div>
                        <time>{a.time}</time>
                      </div>
                    );
                  })}
                  {autopilot.feed.length === 0 && (
                    <div className="activity-item">
                      <span className="activity-mark sent">→</span>
                      <div>
                        <strong>No activity yet today</strong>
                        <p>The next daily trigger will populate this feed.</p>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  className="text-button"
                  onClick={() => setIsActivityOpen(true)}
                  type="button"
                >
                  View all activity <Icon name="arrow" />
                </button>
              </section>

              <section className="impact-card" id="wins">
                <p className="eyebrow">SENDER CAPACITY TODAY</p>
                <h2>
                  {senders.length > 0
                    ? `${senders.length} ${senders.length === 1 ? "sender" : "senders"} available.`
                    : "All senders at their daily limit."}
                </h2>
                {topSender && (
                  <>
                    <div className="impact-amount">
                      {topSender.sendsToday}/{topSender.dailyLimit}
                    </div>
                    <p className="impact-subtitle">
                      {topSender.name} · {topSender.campaign} campaign
                    </p>
                    <div className="impact-bar">
                      <span
                        style={{
                          width: `${topSender.dailyLimit > 0 ? Math.min(100, Math.round((topSender.sendsToday / topSender.dailyLimit) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                    <div className="impact-labels">
                      <span>Daily limit: {topSender.dailyLimit}</span>
                      <strong>
                        {topSender.dailyLimit > 0
                          ? Math.round(
                              (topSender.sendsToday / topSender.dailyLimit) * 100
                            )
                          : 0}
                        %
                      </strong>
                    </div>
                  </>
                )}
                <div className="roi-row">
                  <span>Reply rate</span>
                  <strong>{replyRate}%</strong>
                </div>
              </section>

              {data.recentWins.length > 0 && (
                <blockquote>
                  Latest win: {data.recentWins[0].name} replied on “
                  {data.recentWins[0].sequence}”.
                  <cite>— straight from your pipeline</cite>
                </blockquote>
              )}
            </aside>
          </div>
        )}
      </section>

      {selected && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="review-title"
            aria-modal="true"
            className="review-modal"
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">QUEUED FOLLOW-UP</p>
                <h2 id="review-title">
                  Next email for {selected.name.split(" ")[0]}
                </h2>
              </div>
              <button
                aria-label="Close follow-up review"
                className="close-button"
                onClick={() => setSelected(null)}
                ref={reviewCloseButtonRef}
              >
                ×
              </button>
            </div>
            <div className="customer-context">
              <span className={`avatar ${selected.accent}`}>
                {selected.initials}
              </span>
              <div>
                <strong>{selected.name}</strong>
                <p>
                  {selected.company} · {selected.email}
                </p>
              </div>
              <strong>Step {selected.step}</strong>
            </div>
            <label className="message-label" htmlFor="follow-up-message">
              EMAIL · {selected.previewSubject || "(no subject on template)"}
            </label>
            <textarea
              id="follow-up-message"
              readOnly
              value={
                selected.previewBody ||
                "No template body found for this step — check the templates table."
              }
            />
            <div className="reason-row">
              <span>✦</span>
              <p>
                <strong>Why now:</strong> {selected.signal}. This is the exact
                email /api/send will deliver on the next trigger.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              <button
                className="primary-button"
                onClick={() => markReviewed(selected)}
              >
                Looks good <span>→</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {isActivityOpen && (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsActivityOpen(false);
          }}
          role="presentation"
        >
          <aside
            aria-labelledby="reply-title"
            aria-modal="true"
            className="reply-drawer"
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">LAST 24 HOURS</p>
                <h2 id="reply-title">Everything autopilot did.</h2>
              </div>
              <button
                aria-label="Close activity"
                className="close-button"
                onClick={() => setIsActivityOpen(false)}
                ref={replyCloseButtonRef}
              >
                ×
              </button>
            </div>
            <div className="reply-list">
              {data.autopilot.feed.map((a, i) => (
                <article key={i}>
                  <span className="avatar violet">
                    {(ACTIVITY_MARK[a.kind] ?? ACTIVITY_MARK.sent).glyph}
                  </span>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.detail}</p>
                  </div>
                  <time>{a.time}</time>
                </article>
              ))}
              {data.autopilot.feed.length === 0 && (
                <article>
                  <span className="avatar sand">–</span>
                  <div>
                    <strong>Quiet so far</strong>
                    <p>Activity appears here after the next daily trigger.</p>
                  </div>
                </article>
              )}
            </div>
          </aside>
        </div>
      )}
      {notice && (
        <div aria-live="polite" className="toast" role="status">
          <span>✓</span>
          {notice}
        </div>
      )}
    </main>
  );
}
