import { createClient } from "@supabase/supabase-js";

export const approvedTemplates = {
  dp4: [
    {
      step: 1,
      subject: "skin pen upgrade",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

{{practice_name}} may already have a full treatment menu. The question is whether Dermapen4™ fits the consult, staff conversation, and follow-up already in place.

Before a device review, we map where clients hesitate and what the front desk needs to explain.

Would a short menu review be useful this month?

{{signature}}`,
    },
    {
      step: 2,
      subject: "skin pen upgrade",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Quick follow-up on Dermapen4™. A device can look good in a demo and still miss the mark if the team cannot explain who it is for.

Before a change, we review staff talking points, consult handoffs, and client follow-up.

Would you like the one-page checklist we use before vendor calls?

{{signature}}`,
    },
    {
      step: 3,
      subject: "skin pen upgrade",
      delayDays: 8,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

I will close the loop after this. If the current treatment menu is working, there is no reason to add another conversation.

If Dermapen4™ is on the list, I can share the questions worth asking before a demo.

It keeps the review practical.

Who handles that decision at {{practice_name}}?

{{signature}}`,
    },
  ],
  dp4_b: [
    {
      step: 1,
      subject: "microneedling menu fit",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Dermapen4™ decisions get easier when the team has a clear way to discuss fit, not just features.

We review the consult path, staff questions, and follow-up before a device conversation becomes a vendor call for your team today.

Would a short treatment-menu review be useful this month?

{{signature}}`,
    },
    {
      step: 2,
      subject: "microneedling menu fit",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Quick follow-up on Dermapen4™. A treatment decision is easier when the front desk and providers can explain who the option fits.

We use a short checklist to review consult handoffs, staff language, and client follow-up before a decision moves forward.

Would you like me to send it?

{{signature}}`,
    },
    {
      step: 3,
      subject: "microneedling menu fit",
      delayDays: 8,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Last note from me. If Dermapen4™ is not a current priority, I will leave it there.

If {{practice_name}} is reviewing the menu soon, I can share the questions that keep a device review practical. It keeps the discussion grounded in daily workflow.

Who owns that decision for your team?

{{signature}}`,
    },
  ],
  clearview: [
    {
      step: 1,
      subject: "clearview device review",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

{{practice_name}} may be reviewing its treatment menu. clearVIEW is worth a look only if it fits the client journey and the team can support it.

Before a device decision, we review consult flow, staff questions, and follow-up.

It helps clarify the next step.

Open to a short review?

{{signature}}`,
    },
    {
      step: 2,
      subject: "clearview device review",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Quick follow-up on clearVIEW. The right device conversation starts before a demo. It starts with the questions clients ask and how staff explain options.

I can send a one-page review sheet that keeps the team focused on fit, not hype.

Would that be useful for your team?

{{signature}}`,
    },
    {
      step: 3,
      subject: "clearview device review",
      delayDays: 8,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Last note from me. If clearVIEW is not on the list, I will leave it there. If {{practice_name}} is reviewing devices soon, a quick workflow check can help.

I can share the short checklist or connect with the person who owns the treatment menu.

Which is more useful for your team right now?

{{signature}}`,
    },
  ],
  clearview_b: [
    {
      step: 1,
      subject: "consult flow review",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

clearVIEW is worth considering only when it fits the client journey and the team can support the conversation.

We look at consult flow, staff questions, and follow-up before deciding whether a device review makes sense. It keeps decisions focused on fit.

Would a short workflow review be useful?

{{signature}}`,
    },
    {
      step: 2,
      subject: "consult flow review",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Quick follow-up on clearVIEW. The useful question is not just what a device does. It is whether clients understand the next step.

We use a simple review sheet to surface gaps in consult flow and staff explanations before another device discussion.

Would you like me to send it?

{{signature}}`,
    },
    {
      step: 3,
      subject: "consult flow review",
      delayDays: 8,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Last note from me. If clearVIEW is not on the list, I will leave it there.

If {{practice_name}} is reviewing its treatment process, I can share a short checklist before a device conversation. It keeps the conversation focused on practical next steps.

Who handles that decision for your team?

{{signature}}`,
    },
  ],
  hvac_a: [
    {
      step: 1,
      subject: "the missed job",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

As a shop grows, missed handoffs turn interested callers into quiet leads. Calls, forms, and estimates need a clear next owner.

We map the path and automate the next action with the tools {{company}} already uses.

Would a 15-minute look at the workflow in {{area}} be useful?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 2,
      subject: "the missed job",
      delayDays: 3,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Quick follow-up. After-hours calls and open estimates often sit because nobody owns the next action.

We map the handoff, then add a simple rule so the office does not have to chase it before the busy season.

Would a 15-minute review for {{company}} in {{area}} be useful?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 3,
      subject: "the missed job",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

When the office gets busy, a new lead should not depend on a spreadsheet, voicemail, or someone remembering.

We help HVAC teams move each inquiry to the right person and automate the next follow-up.

Would it help to see the first workflow I would review for {{company}}?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 4,
      subject: "the missed job",
      delayDays: 7,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Last note. I do not know if lead response and follow-up are a priority for {{company}}.

If they are, I can point to the first workflow worth checking before another busy week adds more office work.

Would a 15-minute review be useful, or should I close this out?

Camilo | Automate305
automate305.com`,
    },
  ],
  hvac_b: [
    {
      step: 1,
      subject: "the hidden handoff",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

As a shop grows, {{pain_point}} can become a leak. Calls wait, jobs get lost, and office work grows.

We help HVAC teams map the handoff, find the delay, and automate the next step.

Would a 15-minute look at the process in {{area}} be useful for {{company}}?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 2,
      subject: "the hidden handoff",
      delayDays: 3,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Most owners do not need another app. They need the work between the apps to stop landing on the office.

That is where {{pain_point}} gets expensive. Someone has to remember, chase, or re-enter the same information.

Would it help if I sent the first workflow I would review for {{company}}?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 3,
      subject: "the hidden handoff",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

The most costly process problem is the one nobody owns. A lead comes in, one person sees it, another follows up, and the customer waits.

We help {{company}} give that handoff a clear owner and an automatic next step.

Would a short workflow review be useful for your team in {{area}}?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 4,
      subject: "the hidden handoff",
      delayDays: 7,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

I will make this my last note. {{pain_point}} may already be handled well at {{company}}. If so, no need to reply.

If it is manual, I can show the handoff to review before a busy week exposes it.

Would a 15-minute session be helpful, or should I close the file?

Camilo | Automate305
automate305.com`,
    },
  ],
};

function countWords(value) {
  return value
    .replace(/{{personalized_paragraph}}/g, "a fact about company service in local market")
    .replace(/{{[^}]+}}/g, "sample")
    .match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g)?.length || 0;
}

export function validateTemplates() {
  const issues = [];
  for (const [sequenceName, templates] of Object.entries(approvedTemplates)) {
    for (const template of templates) {
      const bodyWordCount = countWords(template.bodyText);
      const subjectWordCount = countWords(template.subject);
      if (template.bodyText.includes("—")) issues.push(`${sequenceName} step ${template.step}: contains an em dash`);
      if (bodyWordCount < 60 || bodyWordCount > 65) issues.push(`${sequenceName} step ${template.step}: ${bodyWordCount} words`);
      if (subjectWordCount < 3 || subjectWordCount > 4 || template.subject !== template.subject.toLowerCase()) {
        issues.push(`${sequenceName} step ${template.step}: subject must be 3-4 lowercase words`);
      }
    }
  }
  return issues;
}

export async function refreshApprovedTemplates(supabase) {
  const sequenceDefinitions = {
    clearview_b: {
      campaign: "aesthetic",
      description: "clearVIEW B · 3-step · consult-flow angle · aesthetics practices",
    },
    dp4_b: {
      campaign: "aesthetic",
      description: "Dermapen4™ B · 3-step · treatment-menu angle · aesthetics practices",
    },
  };

  for (const [name, sequence] of Object.entries(sequenceDefinitions)) {
    const { error } = await supabase
      .from("sequences")
      .upsert({ active: true, name, ...sequence }, { onConflict: "name" });
    if (error) throw new Error(`Could not create ${name}: ${error.message}`);
  }

  for (const [sequenceName, templates] of Object.entries(approvedTemplates)) {
    const { data: sequence, error: sequenceError } = await supabase
      .from("sequences")
      .select("id")
      .eq("name", sequenceName)
      .single();

    if (sequenceError || !sequence) throw new Error(`Could not load ${sequenceName}: ${sequenceError?.message || "missing sequence"}`);

    const { error } = await supabase
      .from("templates")
      .upsert(
        templates.map((template) => ({
          sequence_id: sequence.id,
          step: template.step,
          subject: template.subject,
          body_text: template.bodyText,
          delay_days: template.delayDays,
        })),
        { onConflict: "sequence_id,step" },
      );

    if (error) throw new Error(`Could not update ${sequenceName}: ${error.message}`);
  }
}

if (process.argv[1]?.endsWith("refresh-approved-template-copy.mjs")) {
  const issues = validateTemplates();
  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exit(1);
  }

  if (process.argv.includes("--validate")) {
    const templateCount = Object.values(approvedTemplates).reduce(
      (total, templates) => total + templates.length,
      0,
    );
    console.log(`All ${templateCount} template bodies meet the copy guardrails.`);
    process.exit(0);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  await refreshApprovedTemplates(supabase);
  console.log("Updated 14 approved OUTBOX email templates.");
}
