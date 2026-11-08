"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importContacts, type ContactImportState } from "@/app/actions";
import type { DashboardContact } from "@/lib/services/dashboard";

const initialImportState: ContactImportState = { message: "", status: "idle" };
const GETLEADS_BATCH_LIMIT = 100;

function csvCell(value: string | null) { return `"${String(value || "").replaceAll('"', '""')}"`; }
function contactName(contact: DashboardContact) { return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact"; }
function enrichmentStatus(contact: DashboardContact) { return contact.personalizedParagraph || contact.websiteObservation || contact.linkedinUrl ? "Enriched" : "Needs enrichment"; }

export function ContactsPagePanel({ contacts }: { contacts: DashboardContact[] }) {
  const router = useRouter();
  const importFormRef = useRef<HTMLFormElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [batchPage, setBatchPage] = useState(0);
  const [batchNotice, setBatchNotice] = useState("");
  const [importState, importAction, importing] = useActionState(importContacts, initialImportState);
  const filteredContacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return contacts;
    return contacts.filter((contact) => [contactName(contact), contact.company, contact.email, contact.city, contact.title, contact.source].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  }, [contacts, query]);
  const batchCount = Math.max(1, Math.ceil(filteredContacts.length / GETLEADS_BATCH_LIMIT));
  const visibleContacts = filteredContacts.slice(batchPage * GETLEADS_BATCH_LIMIT, (batchPage + 1) * GETLEADS_BATCH_LIMIT);
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selectedIds.includes(contact.id));

  useEffect(() => {
    if (importState.status !== "success") return;
    importFormRef.current?.reset();
    router.refresh();
  }, [importState.status, router]);

  function toggleContact(contactId: string) {
    setSelectedIds((current) => {
      if (current.includes(contactId)) return current.filter((id) => id !== contactId);
      if (current.length >= GETLEADS_BATCH_LIMIT) {
        setBatchNotice(`A GetLeads batch is capped at ${GETLEADS_BATCH_LIMIT} contacts. Export this batch, then select the next group.`);
        return current;
      }
      return [...current, contactId];
    });
  }
  function toggleVisibleContacts() {
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleContacts.some((contact) => contact.id === id)) : visibleContacts.map((contact) => contact.id));
    setBatchNotice(visibleContacts.length === GETLEADS_BATCH_LIMIT ? `Selected this ${GETLEADS_BATCH_LIMIT}-contact batch. Export it, then move to the next batch.` : "");
  }
  function exportContacts(rows: DashboardContact[], filename = "outbox-contacts.csv") {
    const headers = ["first_name", "last_name", "company", "email", "title", "city", "phone", "linkedin_url", "website", "personalization_signal", "source"];
    const csv = [headers.join(","), ...rows.map((contact) => [contact.firstName, contact.lastName, contact.company, contact.email, contact.title, contact.city, contact.phone, contact.linkedinUrl, contact.websiteObservation, contact.personalizedParagraph, contact.source].map(csvCell).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  }
  function prepareGetLeadsBatch() {
    const selectedContacts = contacts.filter((contact) => selectedIds.includes(contact.id));
    exportContacts(selectedContacts, "outbox-getleads-batch.csv");
    setBatchNotice(`Downloaded a ${selectedContacts.length}-contact GetLeads CSV. Upload it to your Cowork GetLeads run, then import the enriched CSV back into OUTBOX.`);
    setSelectedIds([]);
    if (batchPage < batchCount - 1) setBatchPage((current) => current + 1);
  }

  return <>
    <section className="panel contacts-hero">
      <div className="panel-heading"><div><p className="section-kicker">CONTACTS</p><h2>Build, enrich, and enroll your list</h2></div><span>{contacts.length.toLocaleString()} contacts</span></div>
      <div className="contacts-summary"><p>Import CSV lists without assigning a campaign. GetLeads batches are capped at 100 contacts so you can review quality before enrolling.</p><div><button className="secondary-action" onClick={() => exportContacts(selectedIds.length ? contacts.filter((contact) => selectedIds.includes(contact.id)) : contacts)} type="button">Export {selectedIds.length ? "selected" : "all"} CSV</button><a className="secondary-action" href="#import">Import CSV</a></div></div>
    </section>
    <section className="panel contacts-table-panel">
      <div className="contacts-toolbar"><label><span>Search contacts</span><input onChange={(event) => { setQuery(event.target.value); setBatchPage(0); }} placeholder="Name, company, city…" value={query} /></label><div><button className="secondary-action" disabled={selectedIds.length === 0} onClick={prepareGetLeadsBatch} type="button">Enrich with GetLeads{selectedIds.length ? ` (${selectedIds.length})` : ""}</button></div></div>
      <div className="batch-help"><span>One GetLeads batch at a time. Select all chooses this page, up to {GETLEADS_BATCH_LIMIT} contacts.</span>{filteredContacts.length > GETLEADS_BATCH_LIMIT ? <div><button className="secondary-action" disabled={batchPage === 0} onClick={() => { setSelectedIds([]); setBatchPage((current) => current - 1); }} type="button">Previous 100</button><strong>{batchPage * GETLEADS_BATCH_LIMIT + 1}–{Math.min((batchPage + 1) * GETLEADS_BATCH_LIMIT, filteredContacts.length)} of {filteredContacts.length}</strong><button className="secondary-action" disabled={batchPage >= batchCount - 1} onClick={() => { setSelectedIds([]); setBatchPage((current) => current + 1); }} type="button">Next 100</button></div> : null}</div>
      {batchNotice ? <div className="action-result" role="status"><strong>{batchNotice}</strong></div> : null}
      <div className="table-scroll contacts-table"><table><thead><tr><th><input aria-label={`Select this ${GETLEADS_BATCH_LIMIT}-contact batch`} checked={allVisibleSelected} onChange={toggleVisibleContacts} type="checkbox" /></th><th>Contact</th><th>Company</th><th>Role & location</th><th>Verified email</th><th>Phone</th><th>LinkedIn</th><th>Signal</th><th>Status</th></tr></thead><tbody>{visibleContacts.map((contact) => <tr key={contact.id}><td><input aria-label={`Select ${contactName(contact)}`} checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} type="checkbox" /></td><td><strong>{contactName(contact)}</strong><small>{contact.source || "manual"}</small></td><td>{contact.company || "—"}</td><td>{contact.title || "—"}<small>{contact.city || contact.area || "—"}</small></td><td><a href={`mailto:${contact.email}`}>{contact.email}</a></td><td>{contact.phone || "—"}</td><td>{contact.linkedinUrl ? <a href={contact.linkedinUrl} rel="noreferrer" target="_blank">View</a> : "—"}</td><td className="signal-cell">{contact.personalizedParagraph || contact.websiteObservation || "—"}</td><td><span className={`status-pill ${enrichmentStatus(contact) === "Enriched" ? "warm" : "warming"}`}>{enrichmentStatus(contact).toUpperCase()}</span></td></tr>)}</tbody></table></div>
      {filteredContacts.length === 0 ? <div className="empty-state"><strong>No contacts found</strong><p>Import a CSV or change the search to see your records.</p></div> : null}
    </section>
    <section className="panel contacts-import-panel" id="import"><div className="panel-heading"><div><p className="section-kicker">CSV IMPORT</p><h2>Bring in contacts first</h2></div><span>No sequence required</span></div><form action={importAction} className="contact-import-form" ref={importFormRef}><div className="import-controls"><label className="file-field">CSV FILE<input accept=".csv,text/csv" name="contactFile" type="file" /></label><label className="csv-paste-field">OR PASTE CSV<textarea name="contactsCsv" placeholder={'email,first_name,last_name,company,title,city\njamie@example.com,Jamie,Lee,Example Co,Owner,Miami'} /></label></div><div className="import-footer"><p>CSV headers match automatically. Useful columns include verified email, phone or cellphone, LinkedIn URL, job title, city, website, source, and personalization signal.</p><button disabled={importing} type="submit">{importing ? "Importing…" : "Import contacts"}</button></div>{importState.message ? <div className={`action-result ${importState.status}`} role="status"><strong>{importState.message}</strong>{importState.details ? <span>{importState.details.enrolled} imported · {importState.details.duplicates} existing/duplicate · {importState.details.invalid} invalid</span> : null}</div> : null}</form></section>
  </>;
}
