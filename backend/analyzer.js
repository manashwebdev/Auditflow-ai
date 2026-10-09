import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";

const PENALTY = { Critical: 25, High: 15, Medium: 8, Low: 3 };
const LOSS = { Critical: "6-9%", High: "3-5%", Medium: "1-3%", Low: "<1%" };
const BUZZ = ["revolutionize", "synergy", "cutting-edge", "next-gen", "seamless", "robust", "world-class", "innovative", "leverage", "game-changing", "all-in-one", "empower", "state-of-the-art", "best-in-class"];
const GENERIC_CTA = ["learn more", "submit", "click here", "read more", "get started", "more info", "continue"];
const TRUST = {
  testimonials: /testimonial|what (our )?(customers|users|clients) say|loved by/i,
  logos: /trusted by|used by|our customers|as seen (in|on)|partners/i,
  ratings: /\b[1-5](\.\d)?\s?(\/|out of)\s?5\b|★|stars?\b|g2|capterra|trustpilot/i,
  guarantee: /money[- ]back|guarantee|cancel anytime|no credit card|free trial/i,
  security: /soc ?2|gdpr|iso ?27001|ssl|secure|encrypted|hipaa/i,
  caseStudies: /case stud(y|ies)|success stor(y|ies)/i,
};

// Block private/internal targets (SSRF protection).
export async function assertPublicUrl(raw) {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are allowed");
  const { address } = await dns.lookup(u.hostname);
  const priv = net.isIPv4(address)
    ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
    : /^(::1|fc|fd|fe80)/i.test(address);
  if (priv) throw new Error("That address is not publicly reachable");
  return u.href;
}

// Stage 1 and 2: render page, capture screenshots, extract data.
export async function capture(url, id, onStep = () => {}) {
  const candidates = [
  
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);
  let executablePath;
  for (const p of candidates) {
    if (fs.existsSync(p)) { executablePath = p; break; }
  }
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"]
});
  try {
    const page = await browser.newPage();
    const reqs = [];
    page.on("response", (r) => reqs.push({ url: r.url(), type: r.request().resourceType(), size: +(r.headers()["content-length"] || 0) }));
    await page.setViewport({ width: 1366, height: 768 });
    onStep("Analyzing structure");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const html = await page.content();
    const loadMs = await page.evaluate(() => Math.round(performance.getEntriesByType("navigation")[0]?.loadEventEnd || 0));
    onStep("Capturing screenshots");
    fs.mkdirSync("shots", { recursive: true });
    await page.screenshot({ path: `shots/${id}-desktop.png`, fullPage: true });
    const data = await page.evaluate(() => {
      const fold = innerHeight;
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ctas = [...document.querySelectorAll("a, button, [role=button]")].filter(vis)
        .map((e) => ({ text: e.innerText.trim().replace(/\s+/g, " "), top: Math.round(e.getBoundingClientRect().top + scrollY), nav: !!e.closest("nav, header, footer") }))
        .filter((c) => c.text && c.text.length < 40);
      const imgs = [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, lazy: i.loading === "lazy", nw: i.naturalWidth, w: i.clientWidth, top: Math.round(i.getBoundingClientRect().top + scrollY) }));
      const h1 = document.querySelector("h1");
      const sub = h1?.parentElement?.querySelector("p")?.innerText || "";
      return { fold, ctas, imgs, h1: h1?.innerText.trim() || "", sub: sub.trim(), text: document.body.innerText, foldText: [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.getBoundingClientRect().top < fold).map((e) => e.innerText || "").join(" "), scripts: document.scripts.length, mobileMeta: !!document.querySelector('meta[name=viewport]') };
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.reload({ waitUntil: "networkidle2" });
    await page.screenshot({ path: `shots/${id}-mobile.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    return { html, data, reqs, loadMs, overflow };
  } finally { await browser.close(); }
}

// Stage 3: rule-based checks. Each rule returns an issue or nothing.
export function analyze({ html, data, reqs, loadMs, overflow }, onStep = () => {}) {
  const $ = cheerio.load(html);
  const issues = [];
  const add = (category, severity, title, fix) => issues.push({ category, severity, title, fix, lost: LOSS[severity] });
  const fold = data.fold;
  const lower = data.text.toLowerCase();

  onStep("Checking CTAs");
  const heroCtas = data.ctas.filter((c) => !c.nav && c.top < fold);
  if (!heroCtas.length) add("Conversion", "Critical", "No call to action above the fold", "Place one clear primary button in the hero.");
  if (heroCtas.length > 3) add("Conversion", "High", `${heroCtas.length} competing actions in the hero`, "Keep one primary action and one quiet secondary link.");
  const weak = heroCtas.filter((c) => GENERIC_CTA.includes(c.text.toLowerCase()));
  if (weak.length) add("Conversion", "High", `Generic CTA wording: "${weak[0].text}"`, "Name the outcome, e.g. Start free trial or Get my audit.");
  if (!$("form").length && !data.ctas.some((c) => /sign ?up|trial|demo|buy|start/i.test(c.text))) add("Conversion", "High", "No sign-up or purchase path found", "Add a visible sign-up, trial or demo action.");
  if (data.ctas.filter((c) => !c.nav).length > 25) add("UX", "Medium", "Too many links and buttons on the page", "Cut secondary links so the main action stands out.");

  onStep("Analyzing copy");
  const words = data.h1.split(/\s+/).filter(Boolean).length;
  if (!data.h1) add("Copy", "Critical", "No H1 headline found", "Add one headline that states the customer's result.");
  else if (words > 14 || words < 3) add("Copy", "Medium", `Headline is ${words} words`, "Aim for 6 to 12 words that state the result.");
  const buzz = BUZZ.filter((b) => lower.includes(b));
  if (buzz.length) add("Copy", buzz.length > 2 ? "High" : "Medium", `Buzzwords found: ${buzz.slice(0, 4).join(", ")}`, "Replace buzzwords with numbers and concrete outcomes.");
  const you = (lower.match(/\byou(r)?\b/g) || []).length, we = (lower.match(/\b(we|our)\b/g) || []).length;
  if (we > you) add("Copy", "Medium", "Copy talks about the company more than the customer", "Rewrite features as benefits using 'you'.");
  if (!/\d/.test(data.foldText)) add("Copy", "Low", "No numbers or timeframes above the fold", "Add a specific number, such as 'in 5 minutes' or '2,000 teams'.");

  onStep("Evaluating trust signals");
  const found = Object.entries(TRUST).filter(([, re]) => re.test(data.text)).map(([k]) => k);
  const foldTrust = Object.values(TRUST).some((re) => re.test(data.foldText));
  if (!foldTrust) add("Trust", "Critical", "No social proof above the fold", "Add 3 customer logos or a rating under the hero.");
  if (!found.includes("testimonials")) add("Trust", "High", "No testimonials found", "Add 2 to 3 named customer quotes with results.");
  if (!found.includes("guarantee")) add("Trust", "Medium", "No guarantee or risk reducer", "Add 'free trial', 'no card needed' or a refund promise near the CTA.");
  if (!found.includes("caseStudies") && !found.includes("ratings")) add("Trust", "Low", "No case studies or review ratings", "Link one case study or show a review score.");
  if (!/faq|frequently asked/i.test(data.text)) add("Conversion", "Medium", "No FAQ section", "Answer pricing, setup and cancellation questions before the footer.");

  // SEO
  const title = $("title").text().trim(), desc = $('meta[name=description]').attr("content") || "";
  if (!title) add("SEO", "Critical", "Missing page title", "Add a 50 to 60 character title with your main keyword.");
  else if (title.length > 65 || title.length < 20) add("SEO", "Low", `Title is ${title.length} characters`, "Keep it between 30 and 60 characters.");
  if (!desc) add("SEO", "High", "Missing meta description", "Write a 140 to 160 character description.");
  else if (desc.length > 170 || desc.length < 70) add("SEO", "Low", `Meta description is ${desc.length} characters`, "Keep it between 120 and 160 characters.");
  const h1s = $("h1").length;
  if (h1s > 1) add("SEO", "Medium", `${h1s} H1 tags on the page`, "Use a single H1 and H2s for sections.");
  const noAlt = data.imgs.filter((i) => !i.alt).length;
  if (noAlt) add("SEO", noAlt > 5 ? "Medium" : "Low", `${noAlt} images without alt text`, "Add short descriptive alt text.");
  if (!$('link[rel=canonical]').length) add("SEO", "Low", "No canonical link", "Add a canonical URL to avoid duplicate pages.");

  onStep("Calculating conversion score");
  // UX
  if (!data.mobileMeta) add("UX", "Critical", "No mobile viewport tag", "Add <meta name=viewport content='width=device-width, initial-scale=1'>.");
  if (overflow) add("UX", "High", "Page scrolls sideways on mobile", "Fix elements wider than the screen.");
  const navLinks = $("nav a").length;
  if (navLinks > 8) add("UX", "Medium", `${navLinks} navigation links`, "Reduce navigation to 5 or fewer items.");
  if (!$("footer").length) add("UX", "Low", "No footer found", "Add a footer with contact, privacy and terms links.");

  // Performance
  const imgBytes = reqs.filter((r) => r.type === "image").reduce((a, r) => a + r.size, 0);
  const big = reqs.filter((r) => r.type === "image" && r.size > 500000);
  if (big.length) add("Performance", "High", `${big.length} images over 500 KB`, "Compress to WebP or AVIF and size to display width.");
  const belowNoLazy = data.imgs.filter((i) => i.top > fold && !i.lazy).length;
  if (belowNoLazy > 3) add("Performance", "Medium", `${belowNoLazy} below-fold images are not lazy-loaded`, "Add loading='lazy'.");
  const oversize = data.imgs.filter((i) => i.w && i.nw > i.w * 2.5).length;
  if (oversize) add("Performance", "Low", `${oversize} images far larger than displayed`, "Serve responsive sizes with srcset.");
  if (data.scripts > 25) add("Performance", "Medium", `${data.scripts} script tags`, "Remove unused scripts and defer third-party code.");
  if (loadMs > 4000) add("Performance", "High", `Page load took ${(loadMs / 1000).toFixed(1)}s`, "Cut blocking scripts and large assets.");

  onStep("Generating recommendations");
  const cats = ["Conversion", "Trust", "Copy", "UX", "SEO", "Performance"];
  const scores = Object.fromEntries(cats.map((c) => [c, Math.max(5, 100 - issues.filter((i) => i.category === c).reduce((a, i) => a + PENALTY[i.severity], 0))]));
  const w = { Conversion: 0.25, Trust: 0.2, Copy: 0.2, UX: 0.15, SEO: 0.1, Performance: 0.1 };
  const overall = Math.round(cats.reduce((a, c) => a + scores[c] * w[c], 0));
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    overall, scores, issues, trustFound: found,
    leaks: issues.filter((i) => ["Critical", "High", "Medium"].includes(i.severity)).slice(0, 6),
    extracted: { title, description: desc, h1: data.h1, subheadline: data.sub, ctas: heroCtas.map((c) => c.text), nav: $("nav a").map((_, e) => $(e).text().trim()).get().filter(Boolean).slice(0, 12), imageKB: Math.round(imgBytes / 1024), loadMs },
    headlineTemplate: "Help [who] get [specific result] in [timeframe], without [main pain].",
    note: "Lost-conversion ranges are rule-based estimates from CRO benchmarks, not measured data.",
  };
}
