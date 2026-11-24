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
      subject: "after hours calls",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

When the crew is on a job, the phone still rings. A missed call means the customer dials the next shop.

We built an AI receptionist for HVAC owners. It answers around the clock, checks open times, and books the job.

Want the link to hear it handle a service call?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 2,
      subject: "after hours calls",
      delayDays: 3,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Here is the demo I mentioned: desk.automate305.com

You can hear the receptionist take a service call and offer an open slot. It reads the details back and books only after the caller says yes.

Worth five minutes to try it as if you were calling {{company}}?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 3,
      subject: "after hours calls",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Most homeowners in {{area}} will not leave a voicemail for a broken AC. They call the next shop.

The receptionist picks up after hours and on busy days, takes the name, phone, and email, and puts the visit on the calendar.

Would a 15-minute walkthrough for {{company}} be useful?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 4,
      subject: "after hours calls",
      delayDays: 7,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Last note from me. If every call at {{company}} already gets answered, you can ignore this.

If some go to voicemail after hours, the AI receptionist can pick those up and book from your open times.

The demo is at desk.automate305.com. Should I close this out?

Camilo | Automate305
automate305.com`,
    },
  ],
  hvac_b: [
    {
      step: 1,
      subject: "the unanswered call",
      delayDays: 0,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

For a growing shop, {{pain_point}} starts at the phone. Calls come in while the office is busy, and some never get a callback.

We built an AI receptionist for HVAC teams. It answers around the clock and books from your open times.

Want the link to hear it handle a call?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 2,
      subject: "the unanswered call",
      delayDays: 3,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Here is the demo: desk.automate305.com

It answers a service call, checks availability before offering a slot, and collects name, phone, and email. Nothing is saved until the caller confirms.

Your office gets a booked job, not a voicemail.

Would it help to hear it before your next busy week?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 3,
      subject: "the unanswered call",
      delayDays: 4,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

Your office does not need another app to watch. It needs fewer calls landing on someone already busy.

The receptionist takes overflow and after-hours calls, books from open times, and reads every detail back before saving.

Would a short walkthrough for {{company}} in {{area}} be useful?

Camilo | Automate305
automate305.com`,
    },
    {
      step: 4,
      subject: "the unanswered call",
      delayDays: 7,
      bodyText: `Hi {{first_name}},

{{personalized_paragraph}}

I will make this my last note. If {{pain_point}} is already handled at {{company}}, no need to reply.

If calls still slip after hours, the demo at desk.automate305.com shows how the receptionist answers and books the job.

Would a 15-minute session help, or should I close the file?

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
