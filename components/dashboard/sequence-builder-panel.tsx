"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { saveSequence, type SequenceActionState } from "@/app/actions";
import type { DashboardSequence, DashboardSequenceStep } from "@/lib/services/dashboard";

const initialSequenceState: SequenceActionState = { message: "", status: "idle" };
const newSequenceStep: DashboardSequenceStep = {
  bodyText: "",
  delayDays: 0,
  id: "new-1",
  step: 1,
  subject: "",
};

function createBlankSequence(): DashboardSequence {
  return {
    active: true,
    campaign: "hvac",
    description: "",
    id: "",
    name: "",
    steps: [newSequenceStep],
  };
}

function sequenceDisplayNameText(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "dp4" || normalized === "dp4_a") return "Dermapen4™ A";
  if (normalized === "dp4_b") return "Dermapen4™ B";
  if (normalized === "clearview" || normalized === "clearview_a") return "clearVIEW A";
  if (normalized === "clearview_b") return "clearVIEW B";
  if (normalized === "hvac_a") return "A305 A";
  if (normalized === "hvac_b") return "A305 B";
  return name;
}

function SequenceDisplayName({ name }: { name: string }) {
  const displayName = sequenceDisplayNameText(name);
  const trademarkIndex = displayName.indexOf("™");
  if (trademarkIndex === -1) return <>{displayName}</>;
  return <>{displayName.slice(0, trademarkIndex)}<sup className="trademark">TM</sup>{displayName.slice(trademarkIndex + 1)}</>;
}

export function SequenceBuilderPanel({ sequences }: { sequences: DashboardSequence[] }) {
  const router = useRouter();
  const [selectedSequenceId, setSelectedSequenceId] = useState(sequences[0]?.id || "");
  const [draftSequence, setDraftSequence] = useState<DashboardSequence>(
    sequences[0] || createBlankSequence(),
  );
  const [sequenceState, sequenceAction, sequenceIsPending] = useActionState(
    saveSequence,
    initialSequenceState,
  );

  useEffect(() => {
    if (sequenceState.status === "success") router.refresh();
  }, [router, sequenceState.status]);

  function updateStep(stepIndex: number, changes: Partial<DashboardSequenceStep>) {
    setDraftSequence((currentSequence) => ({
      ...currentSequence,
      steps: currentSequence.steps.map((step, index) =>
        index === stepIndex ? { ...step, ...changes } : step
      ),
    }));
  }

  function addStep() {
    setDraftSequence((currentSequence) => {
      if (currentSequence.steps.length >= 10) return currentSequence;
      const nextStepNumber = currentSequence.steps.length + 1;
      return {
        ...currentSequence,
        steps: [
          ...currentSequence.steps,
          {
            bodyText: "",
            delayDays: 3,
            id: `new-${nextStepNumber}`,
            step: nextStepNumber,
            subject: "",
          },
        ],
      };
    });
  }

  function startNewSequence() {
    setSelectedSequenceId("");
    setDraftSequence(createBlankSequence());
  }

  const serializedSteps = JSON.stringify(draftSequence.steps.map((step) => ({
    bodyText: step.bodyText,
    delayDays: step.delayDays,
    subject: step.subject,
  })));
  const isSystemSequence = ["clearview", "clearview_a", "clearview_b", "dp4", "dp4_a", "dp4_b", "hvac_a", "hvac_b"]
    .includes(draftSequence.name.toLowerCase());

  return (
    <section className="panel sequence-builder-panel" id="sequences">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">SEQUENCE BUILDER</p>
          <h2>Campaign cadence &amp; copy</h2>
        </div>
        <button className="secondary-action" onClick={startNewSequence} type="button">
          New sequence
        </button>
      </div>
      <div className="sequence-builder-layout">
        <nav aria-label="Available sequences" className="sequence-list">
          {sequences.map((sequence) => (
            <button
              className={selectedSequenceId === sequence.id ? "active" : ""}
              key={sequence.id}
              onClick={() => {
                setSelectedSequenceId(sequence.id);
                setDraftSequence(sequence);
              }}
              type="button"
            >
              <strong><SequenceDisplayName name={sequence.name} /></strong>
              <span>{sequence.steps.length} steps · {sequence.active ? "Active" : "Paused"}</span>
            </button>
          ))}
        </nav>
        <form action={sequenceAction} className="sequence-editor">
          <input name="sequenceId" type="hidden" value={draftSequence.id} />
          <input name="steps" type="hidden" value={serializedSteps} />
          {isSystemSequence ? <input name="name" type="hidden" value={draftSequence.name} /> : null}
          <div className="sequence-meta-grid">
            <label>
              NAME
              <input
                name={isSystemSequence ? "displayName" : "name"}
                pattern="[a-z0-9]+(?:_[a-z0-9]+)*"
                readOnly={isSystemSequence}
                required={!isSystemSequence}
                value={isSystemSequence ? sequenceDisplayNameText(draftSequence.name) : draftSequence.name}
                onChange={(event) => setDraftSequence({ ...draftSequence, name: event.target.value })}
              />
            </label>
            <label>
              BRAND / SENDER POOL
              <select
                name="campaign"
                value={draftSequence.campaign}
                onChange={(event) => setDraftSequence({ ...draftSequence, campaign: event.target.value })}
              >
                <option value="hvac">Automate305</option>
                <option value="aesthetic">Aesthetic Device Pro</option>
              </select>
            </label>
            <label className="sequence-description">
              DESCRIPTION
              <input
                maxLength={400}
                name="description"
                value={draftSequence.description}
                onChange={(event) => setDraftSequence({ ...draftSequence, description: event.target.value })}
              />
            </label>
            <label className="active-toggle">
              <input
                checked={draftSequence.active}
                name="active"
                onChange={(event) => setDraftSequence({ ...draftSequence, active: event.target.checked })}
                type="checkbox"
              />
              ACTIVE
            </label>
          </div>
          <div className="sequence-steps">
            {draftSequence.steps.map((step, stepIndex) => (
              <article className="sequence-step" key={step.id}>
                <div className="step-heading">
                  <strong>STEP {stepIndex + 1}</strong>
                  <label>
                    WAIT
                    <input
                      aria-label={`Step ${stepIndex + 1} delay in days`}
                      max={90}
                      min={0}
                      type="number"
                      value={step.delayDays}
                      onChange={(event) => updateStep(stepIndex, { delayDays: Number(event.target.value) })}
                    />
                    DAYS
                  </label>
                </div>
                <label>
                  SUBJECT
                  <input
                    maxLength={200}
                    required
                    value={step.subject}
                    onChange={(event) => updateStep(stepIndex, { subject: event.target.value })}
                  />
                </label>
                <label>
                  PLAIN-TEXT EMAIL
                  <textarea
                    maxLength={10_000}
                    required
                    value={step.bodyText}
                    onChange={(event) => updateStep(stepIndex, { bodyText: event.target.value })}
                  />
                </label>
              </article>
            ))}
          </div>
          <div className="sequence-footer">
            <button
              className="secondary-action"
              disabled={draftSequence.steps.length >= 10}
              onClick={addStep}
              type="button"
            >
              Add step
            </button>
            <span>Steps cannot be deleted while enrollments may reference them.</span>
            <button disabled={sequenceIsPending} type="submit">
              {sequenceIsPending ? "Saving…" : "Save sequence"}
            </button>
          </div>
          {sequenceState.message ? (
            <div className={`action-result ${sequenceState.status}`} role="status">
              <strong>{sequenceState.message}</strong>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
