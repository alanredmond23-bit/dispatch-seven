// Deadline Sync Worker — CourtListener → GitHub Issues
// Called by cron or agent SCHEDULER
// Pulls docket events from CourtListener API, creates GitHub issues if not already tracked

const CL_TOKEN = process.env.COURTLISTENER_TOKEN; // f22ede6af8adbbe2fb44004f58c2f5cd410b2e24
const DOCKET_ID = "67532818"; // 5:24-cr-00376

const GH_API = "https://api.github.com";
const OWNER  = process.env.GITHUB_OWNER || "alanredmond23-bit";
const REPO   = process.env.GITHUB_REPO  || "dispatch-seven";

interface DocketEntry {
  id: number;
  date_filed: string;
  description: string;
  document_number: number;
}

interface SyncResult {
  checked: number;
  created: string[];
  skipped: number;
  errors: string[];
}

async function ghRequest(method: string, path: string, body?: unknown) {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function fetchRecentDocketEntries(days = 7): Promise<DocketEntry[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const url = `https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=${DOCKET_ID}&date_filed__gte=${cutoff}&order_by=-date_filed&page_size=20`;

  const res = await fetch(url, {
    headers: { Authorization: `Token ${CL_TOKEN}` }
  });

  if (!res.ok) throw new Error(`CourtListener API error: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function issueAlreadyExists(docNum: number): Promise<boolean> {
  const issues = await ghRequest("GET",
    `/repos/${OWNER}/${REPO}/issues?state=all&labels=agent:legal&per_page=100`
  );
  if (!Array.isArray(issues)) return false;
  return issues.some((i: { title: string }) =>
    i.title.includes(`Doc ${docNum}`) || i.title.includes(`ECF ${docNum}`)
  );
}

export async function syncDocketToGitHub(): Promise<SyncResult> {
  const result: SyncResult = { checked: 0, created: [], skipped: 0, errors: [] };

  const entries = await fetchRecentDocketEntries(7);
  result.checked = entries.length;

  for (const entry of entries) {
    try {
      const alreadyTracked = await issueAlreadyExists(entry.document_number);
      if (alreadyTracked) { result.skipped++; continue; }

      const issue = await ghRequest("POST", `/repos/${OWNER}/${REPO}/issues`, {
        title: `[DOCKET] ECF ${entry.document_number} — ${entry.description.slice(0, 80)}`,
        labels: ["p0-critical", "agent:legal"],
        body: [
          `**Case:** 5:24-cr-00376 | United States v. Redmond`,
          `**Filed:** ${entry.date_filed}`,
          `**Doc:** ECF ${entry.document_number}`,
          `**Description:** ${entry.description}`,
          ``,
          `**Source:** CourtListener docket entry ${entry.id}`,
          `**Auto-created by:** D7 SCHEDULER agent`,
          ``,
          `> ⚖ Fifth Amendment reservation applies to all production-related entries.`,
        ].join("\n"),
      });

      result.created.push(`#${(issue as { number: number }).number} ECF ${entry.document_number}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      result.errors.push(`ECF ${entry.document_number}: ${(e as Error).message}`);
    }
  }

  return result;
}

// CLI entry point: npx tsx backend/src/workers/deadline-sync.ts
if (import.meta.url === new URL(import.meta.url).href) {
  syncDocketToGitHub()
    .then(r => console.log("Sync result:", JSON.stringify(r, null, 2)))
    .catch(console.error);
}
