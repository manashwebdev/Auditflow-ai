import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { assertPublicUrl, capture, analyze } from "./analyzer.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/shots", express.static("shots"));
app.use(express.static("../frontend"));

const jobs = new Map(); // id -> { status, step, report, error }. Swap for PostgreSQL + Prisma later.
const hits = new Map();
const limited = (ip) => { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 3; };

app.post("/api/audit", async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "Too many audits. Try again in a minute." });
  let url;
  try { url = await assertPublicUrl(String(req.body.url || "")); } catch (e) { return res.status(400).json({ error: e.message }); }
  const id = crypto.randomBytes(5).toString("hex");
  jobs.set(id, { status: "running", step: "Starting" });
  res.status(202).json({ id });
  const onStep = (step) => Object.assign(jobs.get(id), { step });
  try {
    const raw = await capture(url, id, onStep);
    const report = analyze(raw, onStep);
    Object.assign(report, { id, url, screenshots: { desktop: `/shots/${id}-desktop.png`, mobile: `/shots/${id}-mobile.png` } });
    jobs.set(id, { status: "done", step: "Done", report });
  } catch (e) { jobs.set(id, { status: "error", error: "Could not load that page: " + e.message }); }
});

// Poll this for live progress, then read the report from the same response.
app.get("/api/audit/:id", (req, res) => jobs.has(req.params.id) ? res.json(jobs.get(req.params.id)) : res.status(404).json({ error: "Not found" }));

app.listen(process.env.PORT || 4000, () => console.log("AuditFlow API on :4000"));
