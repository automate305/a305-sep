const CONTACT_IMPORT_LIMIT = 250;

const contactFieldAliases = {
  area: "area",
  city: "city",
  company: "company",
  company_name: "company",
  email: "email",
  email_address: "email",
  first: "first_name",
  first_name: "first_name",
  firstname: "first_name",
  last: "last_name",
  last_name: "last_name",
  lastname: "last_name",
  linkedin: "linkedin_url",
  linkedin_url: "linkedin_url",
  linkedin_profile: "linkedin_url",
  pain_point: "pain_point",
  personalized_line: "personalized_line",
  personalized_paragraph: "personalized_paragraph",
  phone: "phone",
  phone_number: "phone",
  cell_phone: "phone",
  cellphone: "phone",
  mobile_phone: "phone",
  practice: "practice_name",
  practice_name: "practice_name",
  source: "source",
  state: "state",
  title: "title",
  website_observation: "website_observation",
  website: "website_observation",
  personalization_signal: "personalized_paragraph",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeader(header) {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvRows(csvText) {
  const rows = [];
  let currentField = "";
  let currentRow = [];
  let insideQuotes = false;

  for (let characterIndex = 0; characterIndex < csvText.length; characterIndex += 1) {
    const character = csvText[characterIndex];
    const nextCharacter = csvText[characterIndex + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      currentField += '"';
      characterIndex += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") characterIndex += 1;
      currentRow.push(currentField);
      if (currentRow.some((field) => field.trim() !== "")) rows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += character;
    }
  }

  if (insideQuotes) throw new Error("The CSV contains an unclosed quoted field.");
  currentRow.push(currentField);
  if (currentRow.some((field) => field.trim() !== "")) rows.push(currentRow);
  return rows;
}

/**
 * Parse an operator-supplied CSV into normalized contact records.
 * Invalid rows are reported and excluded; duplicate emails keep the first row.
 */
export function parseContactCsv(csvText) {
  const trimmedCsvText = String(csvText || "").trim();
  if (!trimmedCsvText) {
    return { contacts: [], duplicateCount: 0, errors: ["Add a CSV file or paste CSV data."] };
  }

  const rows = parseCsvRows(trimmedCsvText);
  if (rows.length < 2) {
    return { contacts: [], duplicateCount: 0, errors: ["The CSV needs a header and at least one contact row."] };
  }
  if (rows.length - 1 > CONTACT_IMPORT_LIMIT) {
    return {
      contacts: [],
      duplicateCount: 0,
      errors: [`Import at most ${CONTACT_IMPORT_LIMIT} contacts at a time.`],
    };
  }

  const headers = rows[0].map((header) => contactFieldAliases[normalizeHeader(header)] || null);
  if (!headers.includes("email")) {
    return { contacts: [], duplicateCount: 0, errors: ["The CSV must include an email column."] };
  }

  const contacts = [];
  const errors = [];
  const seenEmails = new Set();
  let duplicateCount = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const contact = {};

    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const contactField = headers[columnIndex];
      const fieldValue = String(row[columnIndex] || "").trim();
      if (contactField && fieldValue) contact[contactField] = fieldValue;
    }

    const email = String(contact.email || "").toLowerCase();
    if (!emailPattern.test(email)) {
      errors.push(`Row ${rowIndex + 1}: add a valid email address.`);
      continue;
    }
    if (seenEmails.has(email)) {
      duplicateCount += 1;
      continue;
    }

    seenEmails.add(email);
    contacts.push({ ...contact, email, source: contact.source || "dashboard_csv" });
  }

  return { contacts, duplicateCount, errors };
}

export { CONTACT_IMPORT_LIMIT };
