import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, normalize } from "node:path";

function stripQueryAndHash(value) {
  return String(value || "").split(/[?#]/u)[0];
}

function isRemoteReference(value) {
  return /^(?:https?:)?\/\//iu.test(String(value || ""));
}

function normalizeLocalReference(value) {
  const clean = stripQueryAndHash(value).replace(/^\.?\//u, "");
  if (!clean || clean.startsWith("#") || clean.startsWith("data:")) return null;
  const normalized = normalize(clean);
  if (normalized.startsWith("..")) return null;
  return normalized;
}

function localReferencesFromIndex(html) {
  const references = [];
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/giu;
  for (const match of html.matchAll(attrPattern)) {
    const raw = match[1];
    if (isRemoteReference(raw)) continue;
    const path = normalizeLocalReference(raw);
    if (!path) continue;
    references.push({
      raw,
      path,
    });
  }
  return references;
}

function browserBabelUsageFromIndex(html) {
  const issues = [];
  if (/@babel\/standalone|babel(?:\.min)?\.js/iu.test(html)) {
    issues.push("babel-standalone");
  }
  if (/\btype=["']text\/babel["']/iu.test(html)) {
    issues.push("text-babel-script");
  }
  return issues;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function validateDashboardPublicSources({ publicDir = "dashboard/public" } = {}) {
  const indexPath = join(publicDir, "index.html");
  const html = await readFile(indexPath, "utf8");
  const localReferences = localReferencesFromIndex(html);
  const browserBabelUsage = browserBabelUsageFromIndex(html);
  const missing = [];

  for (const reference of localReferences) {
    if (!(await exists(join(publicDir, reference.path)))) {
      missing.push(reference.path);
    }
  }

  return Object.freeze({
    ok: missing.length === 0 && browserBabelUsage.length === 0,
    publicDir,
    indexPath,
    browserBabelUsage: Object.freeze(browserBabelUsage),
    localReferences: Object.freeze(localReferences.map((item) => Object.freeze({ ...item }))),
    missing: Object.freeze([...new Set(missing)]),
  });
}
