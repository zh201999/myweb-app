// ─── SEED CONTACTS ────────────────────────────────────────────────────────────
// This is the embedded default dataset. On load, localStorage takes precedence
// if a saved dataset exists (see NetworkCanvas initialization).

export interface Contact {
  id: number;
  name: string;
  title: string;
  company: string;
  sector: string;
  geo: string;
  strength: number;
  influence: number;
  status: "active" | "priority" | "dormant";
  lastContact: string;
  direct: boolean;
  notes: string;
  tags: string[];
  source: string;
  connection: { type: string; closeness: number; history: string; intro: string };
  noteLog?: { timestamp: string; text: string; images: string[] }[];
}

export const CONTACTS_SEED: Contact[] = [

  // ── MARKETING ─────────────────────────────────────────────
  {
    id: 1,
    name: "Jordan Blake",
    title: "Marketing Strategy Lead",
    company: "BrightPath Marketing",
    sector: "Marketing",
    geo: "Remote, United States",
    strength: 5,
    influence: 6,
    status: "active",
    lastContact: "2026-01-10",
    direct: true,
    notes: "Example marketing contact",
    tags: ["marketing", "strategy", "demo"],
    source: "Demo",
    connection: {
      type: "Professional",
      closeness: 3,
      history: "",
      intro: "System Seed"
    }
  },

  // ── RECRUITMENT ───────────────────────────────────────────
  {
    id: 2,
    name: "Taylor Morgan",
    title: "Talent Acquisition Specialist",
    company: "NorthBridge Recruiting",
    sector: "Recruitment",
    geo: "Chicago, Illinois, United States",
    strength: 4,
    influence: 5,
    status: "active",
    lastContact: "2026-02-12",
    direct: true,
    notes: "Example recruiter contact",
    tags: ["recruitment", "talent", "demo"],
    source: "Demo",
    connection: {
      type: "Professional",
      closeness: 3,
      history: "",
      intro: "System Seed"
    }
  },

  // ── IT ────────────────────────────────────────────────────
  {
    id: 3,
    name: "Alex Rivera",
    title: "Systems Infrastructure Engineer",
    company: "BlueGrid Technologies",
    sector: "IT",
    geo: "Austin, Texas, United States",
    strength: 6,
    influence: 4,
    status: "active",
    lastContact: "2026-03-01",
    direct: true,
    notes: "Example IT contact",
    tags: ["infrastructure", "technology", "demo"],
    source: "Demo",
    connection: {
      type: "Professional",
      closeness: 3,
      history: "",
      intro: "System Seed"
    }
  },

  // ── VENDOR ─────────────────────────────────────────────────
  {
    id: 4,
    name: "Casey Nguyen",
    title: "Solutions Partnership Manager",
    company: "Vertex Supply Group",
    sector: "Vendor",
    geo: "Denver, Colorado, United States",
    strength: 5,
    influence: 5,
    status: "active",
    lastContact: "2026-02-20",
    direct: true,
    notes: "Example vendor contact",
    tags: ["vendor", "partnership", "demo"],
    source: "Demo",
    connection: {
      type: "Professional",
      closeness: 3,
      history: "",
      intro: "System Seed"
    }
  }
];

export const SECTORS_DEFAULT = [
  { name: "Marketing",  bg: "#7c3aed", border: "#c4b5fd" },
  { name: "Recruitment", bg: "#1f2937", border: "#9ca3af" },
  { name: "IT",         bg: "#0f766e", border: "#5eead4" },
  { name: "Vendor",     bg: "#1e3a8a", border: "#93c5fd" },
];
