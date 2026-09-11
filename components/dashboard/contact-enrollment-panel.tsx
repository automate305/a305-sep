"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  importContactsAndEnroll,
  type ContactImportState,
} from "@/app/actions";
import type { DashboardSequence } from "@/lib/services/dashboard";

const initialImportState: ContactImportState = {
  message: "",
  status: "idle",
};

function displaySequenceName(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "dp4" || normalized === "dp4_a") return "Dermapen4™ A";
  if (normalized === "dp4_b") return "Dermapen4™ B";
  if (normalized === "clearview" || normalized === "clearview_a") return "clearVIEW A";
  if (normalized === "clearview_b") return "clearVIEW B";
  if (normalized === "hvac_a") return "A305 A";
  if (normalized === "hvac_b") return "A305 B";
  return name;
}

export function ContactEnrollmentPanel({
  contactCount,
  sequences,
}: {
  contactCount: number;
  sequences: DashboardSequence[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [importState, importAction, importIsPending] = useActionState(
    importContactsAndEnroll,
    initialImportState,
  );
  const activeSequences = sequences.filter((sequence) => sequence.active);

  useEffect(() => {
    if (importState.status !== "success") return;
    formRef.current?.reset();
    router.refresh();
  }, [importState.status, router]);

  return (
    <section className="panel contact-import-panel" id="contacts">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">CONTACT INTAKE</p>
          <h2>Import &amp; enroll contacts</h2>
        </div>
        <span>{contactCount.toLocaleString()} contacts</span>
      </div>
      <form action={importAction} className="contact-import-form" ref={formRef}>
        <div className="import-controls">
          <label>
            SEQUENCE
            <select name="sequenceId" required defaultValue="">
              <option disabled value="">Choose a sequence</option>
              {activeSequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {displaySequenceName(sequence.name)} · {sequence.campaign === "hvac" ? "Automate305" : "Aesthetic Device Pro"}
                </option>
              ))}
            </select>
          </label>
          <label>
            FIRST SEND DATE
            <input name="startDate" type="date" />
          </label>
          <label className="file-field">
            CSV FILE
            <input accept=".csv,text/csv" name="contactFile" type="file" />
          </label>
        </div>
        <label className="csv-paste-field">
          OR PASTE CSV
          <textarea
            name="contactsCsv"
            placeholder={'email,first_name,last_name,company\njamie@example.com,Jamie,Lee,Example Co'}
          />
        </label>
        <div className="import-footer">
          <p>
            Every new enrollment enters the hold queue for first-touch approval. Importing never
            sends email.
          </p>
          <button disabled={importIsPending || activeSequences.length === 0} type="submit">
            {importIsPending ? "Importing…" : "Import and hold for approval"}
          </button>
        </div>
        {importState.message ? (
          <div className={`action-result ${importState.status}`} role="status">
            <strong>{importState.message}</strong>
            {importState.details ? (
              <span>
                {importState.details.enrolled} enrolled · {importState.details.duplicates} existing/duplicate · {importState.details.suppressed} suppressed · {importState.details.invalid} invalid
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
