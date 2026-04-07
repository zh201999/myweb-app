/**
 * csv.ts
 *
 * Client-side CSV import/export for contacts.
 * Pure data layer — no UI, no React. Swap the persistence call-site
 * (importContacts / exportContacts) when moving to Supabase without
 * touching this file.
 */

import type { Contact } from "@/components/network/networkData";

// ── Header aliases → internal field keys ──────────────────────────────────────

const HEADER_ALIASES: Record<string, string> = {
  // name
  name:                    "name",
  // status
  status:                  "status",
  // title / job title
  title:                   "title",
  "job title":             "title",
  jobtitle:                "title",
  // company / organization
  company:                 "company",
  organization:            "company",
  org:                     "company",
  // sector / industry
  sector:                  "sector",
  industry:                "sector",
  // location / geo
  location:                "geo",
  geo:                     "geo",
  city:                    "geo",
  // source
  source:                  "source",
  // connection type
  "connection type":       "connectionType",
  connectiontype:          "connectionType",
  "connection_type":       "connectionType",
  type:                    "connectionType",
  // last contact date
  "last contact":          "lastContact",
  lastcontact:             "lastContact",
  "last_contact":          "lastContact",
  "last contact date":     "lastContact",
  date:                    "lastContact",
  // direct connection (boolean)
  "direct connection":     "direct",
  directconnection:        "direct",
  "direct_connection":     "direct",
  direct:                  "direct",
  // relationship strength
  "relationship strength": "strength",
  strength:                "strength",
  "relationship_strength": "strength",
  closeness:               "strength",
  // influence level
  "influence level":       "influence",
  influence:               "influence",
  "influence_level":       "influence",
  // notes
  notes:                   "notes",
  note:                    "notes",
  // tags
  tags:                    "tags",
  tag:                     "tags",
  labels:                  "tags",
};

function normalizeHeader(raw: string): string {
  const key = raw.toLowerCase().trim();
  return HEADER_ALIASES[key] ?? key;
}

// ── CSV row parser — handles quoted fields containing commas/newlines ──────────

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; } // escaped ""
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// ── Boolean parsing ────────────────────────────────────────────────────────────

function parseBool(v: string): boolean {
  return ["true", "yes", "1"].includes(v.toLowerCase().trim());
}

// ── Number clamping ────────────────────────────────────────────────────────────

function clampScale(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!raw || isNaN(n)) return fallback;
  return Math.min(10, Math.max(1, Math.round(n)));
}

// ── Duplicate key ─────────────────────────────────────────────────────────────

/** Case-insensitive, whitespace-trimmed key used for duplicate detection. */
function dupKey(name: string, company: string): string {
  return `${name.trim().toLowerCase()}|||${company.trim().toLowerCase()}`;
}

// ── Import plan types ─────────────────────────────────────────────────────────

export interface ParsedContact {
  contact: Contact;
  rowNum: number; // 1-based data row (header = row 0)
}

export interface SkippedRow {
  rowNum: number;
  reason: "no-name" | "duplicate";
  hint: string;
}

export interface ImportPlan {
  toImport: ParsedContact[];
  skippedNoName: SkippedRow[];
  skippedDuplicates: SkippedRow[];
}

/**
 * Parse a CSV string and classify every row without touching app state.
 * Call this to populate the preview modal; call confirmImportPlan() after
 * the user confirms.
 */
export function buildImportPlan(
  text: string,
  existingContacts: Contact[],
  startId: number,
): ImportPlan {
  const toImport: ParsedContact[]   = [];
  const skippedNoName: SkippedRow[] = [];
  const skippedDuplicates: SkippedRow[] = [];

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { toImport, skippedNoName, skippedDuplicates };

  const headers  = parseRow(lines[0]).map(normalizeHeader);

  // Build a lookup of existing name+company keys.
  const existingKeys = new Set(existingContacts.map(c => dupKey(c.name, c.company)));
  // Also track keys seen within this CSV to catch intra-file dupes.
  const seenInFile   = new Set<string>();

  let nextId = startId;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;

    const rowNum = i; // human-readable row number (data starts at 1)
    const cells  = parseRow(rawLine);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });

    const name = row["name"]?.trim();
    if (!name) {
      skippedNoName.push({ rowNum, reason: "no-name", hint: `row ${rowNum}: empty name field` });
      continue;
    }

    const company = row["company"]?.trim() ?? "";
    const key     = dupKey(name, company);

    if (existingKeys.has(key) || seenInFile.has(key)) {
      skippedDuplicates.push({
        rowNum,
        reason: "duplicate",
        hint: `row ${rowNum}: "${name}" / "${company || "(no company)"}" already exists`,
      });
      continue;
    }
    seenInFile.add(key);

    // Warn about invalid values but still import with clamped/fallback values.
    const rawDate = row["lastContact"] ?? "";
    if (rawDate && isNaN(Date.parse(rawDate))) {
      console.warn(`[CSV Import] Row ${rowNum}: unrecognised date "${rawDate}" — stored as empty string`);
    }
    const rawStrength  = row["strength"]  ?? "";
    const rawInfluence = row["influence"] ?? "";
    if (rawStrength  && (isNaN(Number(rawStrength))  || Number(rawStrength)  < 1 || Number(rawStrength)  > 10))
      console.warn(`[CSV Import] Row ${rowNum}: strength "${rawStrength}" outside 1–10 — clamped`);
    if (rawInfluence && (isNaN(Number(rawInfluence)) || Number(rawInfluence) < 1 || Number(rawInfluence) > 10))
      console.warn(`[CSV Import] Row ${rowNum}: influence "${rawInfluence}" outside 1–10 — clamped`);

    const rawStatus = row["status"]?.toLowerCase().trim();
    const status: Contact["status"] =
      rawStatus === "priority" ? "priority"
      : rawStatus === "dormant" ? "dormant"
      : "active";

    const tags = row["tags"]
      ? row["tags"].split(",").map(t => t.trim()).filter(Boolean)
      : [];

    toImport.push({
      rowNum,
      contact: {
        id:          nextId++,
        name,
        title:       row["title"]          || "",
        company,
        sector:      row["sector"]         || "",
        geo:         row["geo"]            || "",
        source:      row["source"]         || "",
        status,
        lastContact: (rawDate && !isNaN(Date.parse(rawDate))) ? rawDate : "",
        direct:      (row["direct"] !== undefined && row["direct"] !== "")
                       ? parseBool(row["direct"])
                       : false,
        strength:    clampScale(rawStrength,  5),
        influence:   clampScale(rawInfluence, 5),
        notes:       row["notes"]          || "",
        tags,
        connection: {
          type:      row["connectionType"] || "",
          closeness: 3,
          history:   "",
          intro:     "CSV Import",
        },
      },
    });
  }

  return { toImport, skippedNoName, skippedDuplicates };
}

// ── Import (legacy — kept for backwards compat) ───────────────────────────────

export interface ImportResult {
  imported: Contact[];
  skipped: number;
}

/**
 * Parse a CSV string into an array of Contact objects.
 *
 * @param text     Raw CSV text (including header row).
 * @param startId  First ID to assign; caller should pass (maxExistingId + 1).
 */
export function parseContactsFromCSV(text: string, startId: number): ImportResult {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { imported: [], skipped: 0 };

  const headers = parseRow(lines[0]).map(normalizeHeader);
  const imported: Contact[] = [];
  let skipped = 0;
  let nextId = startId;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue; // blank line

    const cells = parseRow(raw);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });

    const name = row["name"]?.trim();
    if (!name) { skipped++; continue; }

    const rawStatus = row["status"]?.toLowerCase().trim();
    const status: Contact["status"] =
      rawStatus === "priority" ? "priority"
      : rawStatus === "dormant" ? "dormant"
      : "active";

    const tags = row["tags"]
      ? row["tags"].split(",").map(t => t.trim()).filter(Boolean)
      : [];

    imported.push({
      id:          nextId++,
      name,
      title:       row["title"]          || "",
      company:     row["company"]        || "",
      sector:      row["sector"]         || "",
      geo:         row["geo"]            || "",
      source:      row["source"]         || "",
      status,
      lastContact: row["lastContact"]    || "",
      direct:      row["direct"] !== undefined && row["direct"] !== ""
                     ? parseBool(row["direct"])
                     : false,
      strength:    clampScale(row["strength"],  5),
      influence:   clampScale(row["influence"], 5),
      notes:       row["notes"]          || "",
      tags,
      connection: {
        type:      row["connectionType"] || "",
        closeness: 3,
        history:   "",
        intro:     "CSV Import",
      },
    });
  }

  return { imported, skipped };
}

// ── Export ─────────────────────────────────────────────────────────────────────

/** Wrap a cell value in quotes only when necessary. */
function quoteCell(v: string): string {
  const s = String(v ?? "");
  return (s.includes(",") || s.includes('"') || s.includes("\n"))
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const EXPORT_HEADERS = [
  "name",
  "status",
  "title",
  "company",
  "sector",
  "location",
  "source",
  "connection type",
  "last contact",
  "direct connection",
  "relationship strength",
  "influence level",
  "notes",
  "tags",
] as const;

export function exportContactsToCSV(contacts: Contact[]): string {
  const header = EXPORT_HEADERS.map(quoteCell).join(",");

  const rows = contacts.map(c =>
    [
      c.name,
      c.status,
      c.title,
      c.company,
      c.sector,
      c.geo,
      c.source,
      c.connection.type,
      c.lastContact,
      c.direct ? "true" : "false",
      String(c.strength),
      String(c.influence),
      c.notes,
      c.tags.join(", "),
    ].map(quoteCell).join(",")
  );

  return [header, ...rows].join("\n");
}

/** Trigger a browser file download for the given CSV string. */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
