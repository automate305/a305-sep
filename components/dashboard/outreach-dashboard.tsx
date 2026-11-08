"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { lockDashboard, reviewHeldMessage, runDomainAuthenticationCheck, runSmtpReadinessCheck, runWarmup, startWarmup, type DomainAuthenticationResult, type DomainCheckEntry, type SmtpReadinessResult, type WarmupResult } from "@/app/actions";
import { ContactEnrollmentPanel } from "@/components/dashboard/contact-enrollment-panel";
import { ContactsPagePanel } from "@/components/dashboard/contacts-page-panel";
import { SequenceBuilderPanel } from "@/components/dashboard/sequence-builder-panel";
import type {
  DashboardData,
  DashboardContact,
  DashboardQueueItem,
  DashboardSender,
} from "@/lib/services/dashboard";

export type DashboardView = "activity" | "approvals" | "contacts" | "infrastructure" | "overview" | "pipeline" | "sequences";

type BrandFilter = "aesthetic" | "all" | "hvac";
type IconName = "activity" | "arrow" | "check" | "clock" | "edit" | "inbox" | "mail" | "pipeline" | "shield" | "users";

const iconPaths: Record<IconName, string> = {
  activity: "M4 13h3l2-6 4 12 2-6h5",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  inbox: "M4 5h16v14H4zM4 14h4l2 2h4l2-2h4",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  pipeline: "M5 4v16M5 8h8a4 4 0 0 1 4 4v8M13 5l4 3-4 3",
  shield: "M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z",
  users: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 0 1 3 3v2",
};

const brandLabels: Record<BrandFilter, string> = {
  aesthetic: "Aesthetic Device Pro",
  all: "All brands",
  hvac: "Automate305",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" className="ui-icon" fill="none" viewBox="0 0 24 24">
      <path d={iconPaths[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function formatLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "hvac") return "HVAC";
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function SequenceName({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  if (normalized === "dp4" || normalized === "dp4_a") {
    return <>Dermapen4<sup className="trademark">TM</sup> A</>;
  }
  if (normalized === "dp4_b") return <>Dermapen4<sup className="trademark">TM</sup> B</>;
  if (normalized === "clearview" || normalized === "clearview_a") return <>clearVIEW</>;
  if (normalized === "clearview_b") return <>clearVIEW B</>;
  if (normalized === "hvac_a") return <>A305 A</>;
  if (normalized === "hvac_b") return <>A305 B</>;
  return <>{formatLabel(value)}</>;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Recently";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function formatShortDate(value: string | null): string {
  if (!value) return "Date needed";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(value);
}

function BrandBadge({ campaign }: { campaign: string }) {
  return <span className={`brand-badge ${campaign}`}>{campaign === "hvac" ? "A305" : campaign === "aesthetic" ? "ADP" : "GEN"}</span>;
}

function EmptyState({ copy, title }: { copy: string; title: string }) {
  return (
    <div className="empty-state">
      <span><Icon name="check" /></span>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function KpiTile({ label, tone, value }: { label: string; tone?: string; value: number }) {
  return (
    <article className={`kpi-tile ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <i />
    </article>
  );
}

function MailboxRow({ sender }: { sender: DashboardSender }) {
  const capacityUsed = sender.dailyLimit > 0
    ? Math.min((sender.sendsToday / sender.dailyLimit) * 100, 100)
    : 0;
  return (
    <article className="mailbox-row">
      <div className="mailbox-identity">
        <span className={`provider-mark ${sender.campaign}`}>{sender.provider === "Hostinger" ? "H" : "G"}</span>
        <div><strong>{sender.email}</strong><span>{sender.provider}</span></div>
      </div>
      <div className="mailbox-statuses">
        <span className={`status-pill ${sender.warmed ? "warm" : "warming"}`}>{sender.warmed ? "WARM" : "WARMING"}</span>
        <span className={`status-pill ${sender.sendMode}`}>{sender.sendMode.replace("-", " ").toUpperCase()}</span>
      </div>
      <div className="health-score">
        <strong>{sender.healthScore ?? "—"}</strong><span>health</span>
      </div>
      <div className="capacity-meter">
        <div><span style={{ width: `${capacityUsed}%` }} /></div>
        <small>{sender.sendsToday}/{sender.dailyLimit} today</small>
      </div>
    </article>
  );
}

export function OutreachDashboard({
  contacts,
  dashboardData,
  dashboardDate,
  view,
}: {
  contacts: DashboardContact[];
  dashboardData: DashboardData;
  dashboardDate: string;
  view: DashboardView;
}) {
  const router = useRouter();
  const [activeBrand, setActiveBrand] = useState<BrandFilter>("all");
  const [isReplyPanelOpen, setIsReplyPanelOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingHoldId, setPendingHoldId] = useState<string | null>(null);
  const [readinessResult, setReadinessResult] = useState<SmtpReadinessResult | null>(null);
  const [domainResult, setDomainResult] = useState<DomainAuthenticationResult | null>(null);
  const [isDomainCheckPending, startDomainCheckTransition] = useTransition();
  const [warmupResult, setWarmupResult] = useState<WarmupResult | null>(null);
  const [selectedQueueItem, setSelectedQueueItem] = useState<DashboardQueueItem | null>(null);
  const [isReviewPending, startReviewTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const matchesBrand = (campaign: string) => activeBrand === "all" || campaign === activeBrand;
  const filteredPipeline = dashboardData.pipeline.filter((row) => matchesBrand(row.campaign));
  const filteredHolds = dashboardData.holdQueue.filter((item) => matchesBrand(item.campaign));
  const filteredQueue = dashboardData.queue.filter((item) => matchesBrand(item.campaign));
  const filteredActivities = dashboardData.activities.filter((item) => matchesBrand(item.campaign));
  const filteredSenders = dashboardData.senders.filter(
    (sender) => matchesBrand(sender.campaign) && (sender.dailyLimit > 0 || sender.active),
  );
  const warmingSenders = filteredSenders.filter((sender) => !sender.warmed && sender.dailyLimit > 0);
  const topScoringSender = filteredSenders
    .filter((sender) => sender.healthScore !== null)
    .toSorted((left, right) => (right.healthScore || 0) - (left.healthScore || 0))[0];
  const selectedMetrics = dashboardData.brandMetrics[activeBrand];
  const aiBudgetPercent = dashboardData.aiSpend.budget > 0
    ? Math.min((dashboardData.aiSpend.spent / dashboardData.aiSpend.budget) * 100, 100)
    : 0;

  useEffect(() => {
    if (!selectedQueueItem && !isReplyPanelOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedQueueItem(null);
        setIsReplyPanelOpen(false);
      }
    };
    window.addEventListener("keydown", closeOverlay);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOverlay);
    };
  }, [isReplyPanelOpen, selectedQueueItem]);

  function handleHoldReview(enrollmentId: string, decision: "approve" | "skip") {
    setPendingHoldId(enrollmentId);
    startReviewTransition(async () => {
      const result = await reviewHeldMessage(enrollmentId, decision);
      setNotice(result.message);
      setPendingHoldId(null);
      if (result.ok) router.refresh();
      window.setTimeout(() => setNotice(""), 3200);
    });
  }

  function handleReadinessCheck() {
    startReviewTransition(async () => {
      const result = await runSmtpReadinessCheck();
      setReadinessResult(result);
    });
  }

  // DNS reads only. Its own transition, so a slow blocklist lookup never
  // disables the mailbox and warmup buttons.
  function handleDomainCheck() {
    startDomainCheckTransition(async () => {
      const result = await runDomainAuthenticationCheck();
      setDomainResult(result);
    });
  }

  function handleStartWarmup() {
    startReviewTransition(async () => {
      const result = await startWarmup();
      setWarmupResult(result);
      if (result.ok) router.refresh();
    });
  }

  function handleRunWarmup() {
    startReviewTransition(async () => {
      const result = await runWarmup();
      setWarmupResult(result);
      if (result.ok) router.refresh();
    });
  }

  const kpis = [
    { label: "Replies", tone: "violet", value: selectedMetrics.replied },
    { label: "Sent today", tone: "green", value: selectedMetrics.sentToday },
    { label: "Queued today", tone: "blue", value: selectedMetrics.queued },
    { label: "Held", tone: "amber", value: selectedMetrics.held },
    { label: "Active enrollments", tone: "violet", value: selectedMetrics.active },
    { label: "Bounces", tone: "red", value: selectedMetrics.bounced },
  ];

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AUTOMATE<strong>305</strong></span></div>
        <nav aria-label="Dashboard sections" className="dashboard-nav">
          <Link className={view === "overview" ? "active" : ""} href="/"><Icon name="activity" />Overview</Link>
          <Link className={view === "contacts" ? "active" : ""} href="/contacts"><Icon name="users" />Contacts</Link>
          <Link className={view === "pipeline" ? "active" : ""} href="/pipeline"><Icon name="pipeline" />Pipeline</Link>
          <Link className={view === "sequences" ? "active" : ""} href="/sequences"><Icon name="edit" />Sequences</Link>
          <Link className={view === "approvals" ? "active" : ""} href="/approvals"><Icon name="shield" />Approvals<span>{selectedMetrics.held}</span></Link>
          <Link className={view === "infrastructure" ? "active" : ""} href="/infrastructure"><Icon name="inbox" />Infrastructure</Link>
          <Link className={view === "activity" ? "active" : ""} href="/activity"><Icon name="mail" />Activity</Link>
        </nav>
        <section className="sidebar-health">
          <p className="section-kicker">SYSTEM STATUS</p>
          <div><i className={dashboardData.errorMessage ? "offline" : ""} /><span>Supabase</span><strong>{dashboardData.errorMessage ? "Attention" : "Connected"}</strong></div>
          <div><i className={dashboardData.senders.some((sender) => sender.provider === "Google Workspace" && sender.active) ? "" : "offline"} /><span>Google SMTP</span><strong>{dashboardData.senders.some((sender) => sender.provider === "Google Workspace" && sender.active) ? "Live" : "Standby"}</strong></div>
          <div><i className={dashboardData.senders.some((sender) => sender.provider === "Hostinger" && sender.warmed) ? "" : "warming"} /><span>Hostinger</span><strong>{dashboardData.senders.some((sender) => sender.provider === "Hostinger" && sender.warmed) ? "Live" : "Warmup"}</strong></div>
        </section>
        <div className="sidebar-footer">
          <div><span className="account-avatar">CG</span><span><strong>Camilo</strong><small>Administrator</small></span></div>
          <form action={lockDashboard}><button type="submit">Lock</button></form>
        </div>
      </aside>

      <main className="dashboard-workspace" id="overview">
        <header className="dashboard-header">
          <div><p className="eyebrow">{dashboardDate}</p><h1 className="outbox-wordmark">outbox</h1><p>Multi-brand sending, approvals, and mailbox health in one place.</p></div>
          <div className="header-meta"><span className="live-indicator"><i />LIVE DATA</span><small>Updated {formatTimestamp(dashboardData.generatedAt)}</small></div>
        </header>

        <div className="dashboard-content">
          {view !== "contacts" && <div className="brand-switcher" aria-label="Filter dashboard by brand" role="group">
            {(Object.keys(brandLabels) as BrandFilter[]).map((brand) => (
              <button aria-pressed={activeBrand === brand} className={activeBrand === brand ? "active" : ""} key={brand} onClick={() => setActiveBrand(brand)} type="button">
                {brand !== "all" ? <BrandBadge campaign={brand} /> : null}{brandLabels[brand]}
              </button>
            ))}
          </div>}

          {dashboardData.errorMessage ? <div className="configuration-banner" role="status"><strong>Live data unavailable</strong><span>{dashboardData.errorMessage}</span></div> : null}

          {view === "overview" && <section aria-label="Key performance indicators" className="kpi-grid">
            {kpis.map((kpi) => <KpiTile key={kpi.label} {...kpi} />)}
          </section>}

          {view === "overview" && <ContactEnrollmentPanel
            contactCount={dashboardData.contactCount}
            sequences={dashboardData.sequences}
          />}

          {view === "contacts" && <ContactsPagePanel contacts={contacts} />}

          {view === "pipeline" && <section className="panel pipeline-panel" id="pipeline">
            <div className="panel-heading"><div><p className="section-kicker">CAMPAIGNS</p><h2>Pipeline by sequence</h2></div><span>{filteredPipeline.length} sequences</span></div>
            {filteredPipeline.length > 0 ? (
              <div className="table-scroll"><table><thead><tr><th>Sequence</th><th>Brand</th><th>Active</th><th>Replied</th><th>Completed</th><th>Bounced</th><th>Total</th></tr></thead><tbody>
                {filteredPipeline.map((row) => <tr key={`${row.campaign}-${row.sequence}`}><td><strong><SequenceName value={row.sequence} /></strong></td><td><BrandBadge campaign={row.campaign} /></td><td>{row.active}</td><td className="positive">{row.replied}</td><td>{row.completed}</td><td className={row.bounced ? "negative" : ""}>{row.bounced}</td><td><strong>{row.total}</strong></td></tr>)}
              </tbody></table></div>
            ) : <EmptyState title="No sequences yet" copy="Enroll contacts to populate the live pipeline." />}
          </section>}

          {view === "sequences" && <SequenceBuilderPanel
            key={dashboardData.generatedAt}
            sequences={dashboardData.sequences}
          />}

          {view === "approvals" && <section className="panel hold-panel" id="approvals">
            <div className="panel-heading"><div><p className="section-kicker">APPROVAL MODE</p><h2>Hold queue</h2></div><span className={filteredHolds.length ? "attention-count" : ""}>{filteredHolds.length} held</span></div>
            <div className="hold-list">
              {filteredHolds.slice(0, 5).map((item) => (
                <article className="hold-row" key={item.id}>
                  <span className={`contact-avatar ${item.campaign}`}>{item.initials}</span>
                  <div className="hold-contact"><div><strong>{item.name}</strong><BrandBadge campaign={item.campaign} /></div><span>{item.email} · Step {item.step} · <SequenceName value={item.sequenceName} /></span><p><Icon name="shield" />{item.holdReason}</p></div>
                  <div className="hold-actions"><button disabled={isReviewPending && pendingHoldId === item.id} onClick={() => handleHoldReview(item.id, "approve")} type="button">Approve</button><button className="skip" disabled={isReviewPending && pendingHoldId === item.id} onClick={() => handleHoldReview(item.id, "skip")} type="button">Skip</button></div>
                </article>
              ))}
              {filteredHolds.length === 0 ? <EmptyState title="Nothing needs approval" copy="New first-touch enrollments and safety holds appear here." /> : null}
            </div>
          </section>}

          {view === "infrastructure" && <section className="panel mailbox-panel" id="infrastructure">
            <div className="panel-heading"><div><p className="section-kicker">DELIVERABILITY</p><h2>Mailboxes &amp; health</h2></div><div className="readiness-actions"><button className="secondary-action" disabled={isReviewPending} onClick={handleReadinessCheck} type="button">{isReviewPending ? "Checking…" : "Run no-send check"}</button><span>{filteredSenders.length} sending mailboxes</span></div></div>
            <div className="mailbox-list">{filteredSenders.map((sender) => <MailboxRow key={sender.email} sender={sender} />)}</div>
            {filteredSenders.length === 0 ? <EmptyState title="No mailboxes for this brand" copy="Add a warmed sender before activating a campaign." /> : null}
            {readinessResult ? <div className={`readiness-result ${readinessResult.ready ? "ready" : "not-ready"}`}><strong>{readinessResult.message}</strong>{readinessResult.senders.map((sender) => <span key={sender.email}>{sender.email} · {sender.provider} · {sender.status === "ready" ? "authenticated" : sender.error}</span>)}</div> : null}
            {topScoringSender ? (
              <div className="score-breakdown"><div><span className="score-orb">{topScoringSender.healthScore}</span><div><p className="section-kicker">TOP HEALTH SCORE</p><strong>{topScoringSender.email}</strong></div></div><div className="score-components">
                {Object.entries(topScoringSender.healthComponents).map(([name, score]) => <div key={name}><span>{formatLabel(name)}</span><strong>{score ?? "—"}</strong></div>)}
              </div></div>
            ) : <div className="measurement-note"><Icon name="activity" /><span><strong>Health measurement is ready.</strong>Add real provider scores to Supabase; the dashboard will never invent them.</span></div>}
          </section>}

          {view === "infrastructure" && <section className="panel domain-panel" id="domain-authentication">
            <div className="panel-heading"><div><p className="section-kicker">DOMAIN AUTHENTICATION</p><h2>SPF, DKIM, DMARC &amp; blocklists</h2></div><div className="readiness-actions"><button className="secondary-action" disabled={isDomainCheckPending} onClick={handleDomainCheck} type="button">{isDomainCheckPending ? "Looking up…" : domainResult ? "Recheck DNS" : "Check DNS"}</button><span>Read-only · changes no DNS</span></div></div>
            {domainResult ? <>
              <div className={`readiness-result ${domainResult.ok ? "ready" : "not-ready"}`}><strong>{domainResult.message}</strong></div>
              <div className="domain-list">{domainResult.domains.map((report) => <article className="domain-card" key={report.domain}>
                <header><div><strong>{report.domain}</strong><span>{report.provider || "No provider expectations configured"} · checked {formatCheckedTime(report.checkedAt)}</span></div><span className={`domain-status ${report.overall}`}>{report.overall}</span></header>
                {(["spf", "dkim", "dmarc", "mx", "blocklist"] as const).map((check) => <DomainCheckRow entry={report.results[check]} key={check} />)}
              </article>)}</div>
            </> : <div className="measurement-note"><Icon name="activity" /><span><strong>Nothing checked yet.</strong>Every status here comes from a live DNS lookup made when you press the button. Nothing is cached or assumed.</span></div>}
          </section>}

          {view === "infrastructure" && <div className="side-by-side">
            <section className="panel warmup-panel">
              <div className="panel-heading"><div><p className="section-kicker">SAFE RAMP</p><h2>Warmup board</h2></div><div className="readiness-actions"><button className="secondary-action" disabled={isReviewPending} onClick={handleStartWarmup} type="button">Start 21-day warmup</button><button className="secondary-action" disabled={isReviewPending} onClick={handleRunWarmup} type="button">Send today&apos;s seed mail</button></div></div>
              <div className="warmup-list">
                {warmingSenders.map((sender) => <article key={sender.email}><div><strong>{sender.email}</strong><span>{sender.warmupDay ? `Day ${sender.warmupDay} of 21` : "Start date needed"} · Cap {sender.dailyLimit}/day · Seed only</span></div><div className="warmup-progress"><span style={{ width: `${((sender.warmupDay || 0) / 21) * 100}%` }} /></div><small>{sender.projectedGraduation ? `Est. ${formatShortDate(sender.projectedGraduation)}` : "Set warmup date"}</small></article>)}
                {warmingSenders.length === 0 ? <EmptyState title="No mailboxes warming" copy="Warmed senders remain visible in mailbox health." /> : null}
              </div>
              {warmupResult ? <div className={`readiness-result ${warmupResult.ok ? "ready" : "not-ready"}`}><strong>{warmupResult.message}</strong></div> : null}
            </section>

            <section className="panel spend-panel">
              <div className="panel-heading"><div><p className="section-kicker">MONTH TO DATE</p><h2>AI spend</h2></div><span>{Math.round(aiBudgetPercent)}%</span></div>
              <div className="spend-amount"><strong>{formatCurrency(dashboardData.aiSpend.spent)}</strong><span>of {formatCurrency(dashboardData.aiSpend.budget)} budget</span></div>
              <div className="spend-bar"><span style={{ width: `${aiBudgetPercent}%` }} /></div>
              <div className="spend-footer"><span>Remaining</span><strong>{formatCurrency(dashboardData.aiSpend.remaining)}</strong></div>
              {!dashboardData.aiSpend.configured ? <p className="data-note">AI ledger not installed yet; displayed spend is $0, not an estimate.</p> : null}
            </section>
          </div>}

          {view === "activity" && <div className="operations-grid" id="activity">
            <section className="panel queue-panel">
              <div className="panel-heading"><div><p className="section-kicker">NEXT UP</p><h2>Today&apos;s queue</h2></div><span>{filteredQueue.length} due</span></div>
              <div className="queue-list">
                {filteredQueue.slice(0, 7).map((item) => <button className="queue-row" key={item.id} onClick={() => setSelectedQueueItem(item)} type="button"><span className={`step-number ${item.campaign}`}>{item.step}</span><span><strong>{item.name}</strong><small>{item.email}</small></span><BrandBadge campaign={item.campaign} /><Icon name="arrow" /></button>)}
                {filteredQueue.length === 0 ? <EmptyState title="Queue is clear" copy="Approved, due enrollments will appear here." /> : null}
              </div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><p className="section-kicker">SEND LOG</p><h2>Recent activity</h2></div><span>Last {filteredActivities.length}</span></div>
              <div className="activity-list">
                {filteredActivities.map((activity) => <article key={activity.id}><span className={`activity-icon ${activity.status}`}>{activity.status === "sent" ? <Icon name="check" /> : "!"}</span><div><strong>{activity.contactName}</strong><p>{activity.subject}</p><small>{activity.detail}</small></div><div><BrandBadge campaign={activity.campaign} /><time dateTime={activity.occurredAt}>{formatTimestamp(activity.occurredAt)}</time></div></article>)}
                {filteredActivities.length === 0 ? <EmptyState title="No activity yet" copy="Completed send attempts appear here." /> : null}
              </div>
            </section>
          </div>}
        </div>
      </main>

      {selectedQueueItem ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedQueueItem(null); }} role="presentation"><section aria-labelledby="review-title" aria-modal="true" className="review-modal" role="dialog"><div className="modal-header"><div><p className="section-kicker">EMAIL PREVIEW</p><h2 id="review-title">Step {selectedQueueItem.step} for {selectedQueueItem.name}</h2></div><button aria-label="Close email preview" onClick={() => setSelectedQueueItem(null)} ref={closeButtonRef} type="button">×</button></div><div className="preview-contact"><span className={`contact-avatar ${selectedQueueItem.campaign}`}>{selectedQueueItem.initials}</span><span><strong>{selectedQueueItem.company}</strong><small>{selectedQueueItem.email}</small></span><BrandBadge campaign={selectedQueueItem.campaign} /></div><label>SUBJECT<input readOnly value={selectedQueueItem.subject} /></label><label>PLAIN-TEXT PREVIEW<textarea readOnly value={selectedQueueItem.bodyPreview} /></label><p className="preview-note"><Icon name="shield" />Final sender selection and merge happen only inside the protected send route.</p></section></div> : null}

      {isReplyPanelOpen ? <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsReplyPanelOpen(false); }} role="presentation"><aside aria-labelledby="reply-title" aria-modal="true" className="reply-drawer" role="dialog"><div className="modal-header"><div><p className="section-kicker">RECENT REPLIES</p><h2 id="reply-title">Contacts who stopped their sequence</h2></div><button aria-label="Close recent replies" onClick={() => setIsReplyPanelOpen(false)} ref={closeButtonRef} type="button">×</button></div>{dashboardData.replies.map((reply) => <article key={reply.id}><BrandBadge campaign={reply.campaign} /><div><strong>{reply.name}</strong><p>{reply.company} · <SequenceName value={reply.sequenceName} /></p><a href={`mailto:${reply.email}`}>{reply.email}</a></div><time dateTime={reply.completedAt || undefined}>{formatTimestamp(reply.completedAt)}</time></article>)}{dashboardData.replies.length === 0 ? <EmptyState title="No replies recorded" copy="Replies appear after the protected status route records them." /> : null}</aside></div> : null}

      <button aria-label="Open recent replies" className="floating-replies" onClick={() => setIsReplyPanelOpen(true)} type="button"><Icon name="mail" /><span>{dashboardData.replies.length}</span></button>
      {notice ? <div aria-live="polite" className="toast" role="status"><Icon name="check" />{notice}</div> : null}
    </div>
  );
}

const DOMAIN_CHECK_LABELS: Record<string, string> = {
  blocklist: "Blocklists",
  dkim: "DKIM",
  dmarc: "DMARC",
  mx: "MX",
  spf: "SPF",
};

function formatCheckedTime(isoTimestamp: string) {
  return new Date(isoTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Record text comes from DNS, which is untrusted. It is rendered as React
// text children only, so it is escaped, never interpreted as markup.
function DomainCheckRow({ entry }: { entry: DomainCheckEntry }) {
  return (
    <div className="domain-check">
      <div className="domain-check-head">
        <span className={`domain-status ${entry.status}`}>{entry.status}</span>
        <strong>{DOMAIN_CHECK_LABELS[entry.check] || entry.check}</strong>
        <span className="domain-check-detail">{entry.detail}</span>
        <time dateTime={entry.checkedAt}>{formatCheckedTime(entry.checkedAt)}</time>
      </div>
      {entry.warnings.map((warning) => <p className="domain-warning" key={warning}>{warning}</p>)}
      {entry.observed.length > 0 ? <details><summary>What DNS returned ({entry.queried.length} {entry.queried.length === 1 ? "query" : "queries"})</summary><ul>{entry.observed.map((line) => <li key={line}><code>{line}</code></li>)}</ul></details> : null}
    </div>
  );
}

