// Task completion endpoint + milestone automation
// POST /api/v1/tasks/:id/done  — closes GitHub issue, checks milestone completion
// Milestone completion: close all remaining, post Slack, create next milestone issues

import { Hono } from "hono";

const GH_API = "https://api.github.com";
const OWNER  = process.env.GITHUB_OWNER  || "alanredmond23-bit";
const REPO   = process.env.GITHUB_REPO   || "dispatch-seven";

// Milestone chain — what to auto-create when a milestone completes
const NEXT_MILESTONE: Record<string, string> = {
  "M0 — Pre-Build":       "M1 — Swarm Foundation",
  "M1 — Swarm Foundation":"M2 — Legal Pipeline",
  "M2 — Legal Pipeline":  "M3 — Trial Ready",
};

const MILESTONE_SEEDS: Record<string, { title: string; labels: string[] }[]> = {
  "M1 — Swarm Foundation": [
    { title: "Hono backend: deploy to Azure Container Apps", labels: ["p0-critical","agent:infra"] },
    { title: "Frontend: scaffold Vite 5 + React 18 + Tailwind 4", labels: ["p0-critical","agent:build"] },
    { title: "12-agent swarm: implement message bus", labels: ["p0-critical","agent:build"] },
    { title: "Netlify: link dispatch-seven frontend and deploy", labels: ["p1-high","agent:infra"] },
  ],
  "M2 — Legal Pipeline": [
    { title: "Deepgram: transcribe first batch of Five9 WAVs", labels: ["p0-critical","agent:legal"] },
    { title: "Supabase legalwin2026: initialize vector index", labels: ["p0-critical","agent:infra"] },
    { title: "Azure AI Search: build BM25+vector hybrid index", labels: ["p1-high","agent:legal"] },
    { title: "Franks motion: document Five9 CDR 77.6% failure rate", labels: ["p0-critical","agent:legal"] },
  ],
  "M3 — Trial Ready": [
    { title: "Trial prep: complete exhibit list", labels: ["p0-critical","agent:legal"] },
    { title: "Trial prep: cross-examination outlines — SA Simmons", labels: ["p0-critical","agent:legal"] },
    { title: "Trial prep: coordinate with co-counsel Spizer (Dilworth)", labels: ["p0-critical","agent:legal"] },
    { title: "D7 full ops: all 12 agents tested and running", labels: ["p0-critical","agent:build"] },
  ],
};

export const completionRoutes = new Hono();

async function ghRequest(method: string, path: string, body?: unknown) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
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

async function postSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function checkMilestoneCompletion(milestoneNumber: number, milestoneTitle: string) {
  // Check if all issues in this milestone are now closed
  const openIssues = await ghRequest("GET",
    `/repos/${OWNER}/${REPO}/issues?milestone=${milestoneNumber}&state=open&per_page=50`
  );
  if (!Array.isArray(openIssues) || openIssues.length > 0) return; // still open issues

  console.log(`Milestone complete: ${milestoneTitle}`);

  // Post Slack summary
  const closedIssues = await ghRequest("GET",
    `/repos/${OWNER}/${REPO}/issues?milestone=${milestoneNumber}&state=closed&per_page=50`
  );
  const count = Array.isArray(closedIssues) ? closedIssues.length : 0;
  await postSlack(
    `✅ *D7 Milestone Complete: ${milestoneTitle}*
${count} issues closed.
_https://github.com/${OWNER}/${REPO}/milestone/${milestoneNumber}_`
  );

  // Auto-create next milestone's seed issues
  const nextTitle = NEXT_MILESTONE[milestoneTitle];
  if (!nextTitle) return;

  const milestones = await ghRequest("GET", `/repos/${OWNER}/${REPO}/milestones`);
  const nextMs = Array.isArray(milestones)
    ? milestones.find((m: { title: string }) => m.title === nextTitle)
    : null;

  if (!nextMs) {
    console.warn(`Next milestone "${nextTitle}" not found — skipping seed`);
    return;
  }

  const seeds = MILESTONE_SEEDS[nextTitle] || [];
  for (const seed of seeds) {
    await ghRequest("POST", `/repos/${OWNER}/${REPO}/issues`, {
      title: seed.title,
      labels: seed.labels,
      milestone: nextMs.number,
      body: `Auto-created on completion of **${milestoneTitle}**.

Part of ${nextTitle} milestone.`,
    });
    await new Promise(r => setTimeout(r, 200)); // avoid rate limit
  }

  await postSlack(`🚀 *D7 Next Milestone: ${nextTitle}*
${seeds.length} seed issues auto-created.`);
  console.log(`Seeded ${seeds.length} issues for: ${nextTitle}`);
}

// POST /api/v1/completion/:issueNumber
completionRoutes.post("/:issueNumber", async (c) => {
  const num = parseInt(c.req.param("issueNumber"), 10);
  if (isNaN(num)) return c.json({ error: "Invalid issue number" }, 400);

  // Close the issue
  const issue = await ghRequest("PATCH", `/repos/${OWNER}/${REPO}/issues/${num}`, { state: "closed" }) as { milestone?: { number: number; title: string }; title?: string; html_url?: string };

  if (!("title" in issue)) return c.json({ error: "Failed to close issue" }, 500);

  console.log(`Issue #${num} closed by agent: ${issue.title}`);

  // Check milestone completion (async — don't block response)
  if (issue.milestone) {
    setImmediate(() =>
      checkMilestoneCompletion(issue.milestone!.number, issue.milestone!.title)
        .catch(console.error)
    );
  }

  return c.json({
    closed: true,
    issue: { number: num, title: issue.title, url: issue.html_url },
    milestone: issue.milestone?.title || null,
  });
});
