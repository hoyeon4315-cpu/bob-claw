// adapter-templates — family→reference adapter whitelist for Codex coder.
// output-validator rejects diffs that touch family-mismatched paths.

export const FAMILY_TEMPLATES = Object.freeze({
  cl_lp: Object.freeze({
    referencePaths: ["src/treasury/adapters/aerodrome-cl.mjs", "src/treasury/adapters/uniswap-v3.mjs"],
    requiredExports: ["enter", "exit", "getRangeHealth"],
  }),
  lending_loop: Object.freeze({
    referencePaths: ["src/treasury/adapters/aave-v3.mjs", "src/treasury/adapters/morpho-blue.mjs"],
    requiredExports: ["openLoop", "unwindLoop", "getHealthFactor"],
  }),
  vault_share: Object.freeze({
    referencePaths: ["src/treasury/adapters/beefy.mjs", "src/treasury/adapters/erc4626.mjs"],
    requiredExports: ["deposit", "withdraw", "getShareValue"],
  }),
  basis: Object.freeze({
    referencePaths: ["src/treasury/adapters/gmx-basis.mjs"],
    requiredExports: ["openBasis", "closeBasis", "getFundingRate"],
  }),
  campaign_only: Object.freeze({
    referencePaths: ["src/treasury/adapters/campaign-claim.mjs"],
    requiredExports: ["claim", "getCampaignHealth"],
  }),
});

export function getFamilyTemplate(family) {
  return FAMILY_TEMPLATES[family] || null;
}

export function isFamilyAllowedPath(family, path) {
  const tmpl = getFamilyTemplate(family);
  if (!tmpl) return false;
  if (path.startsWith("test/") || path.startsWith("research/")) return true;
  if (path.startsWith("src/treasury/adapters/")) {
    return true;
  }
  return tmpl.referencePaths.some((ref) => path === ref);
}

export function validateScaffoldOutput({ family, files = [] }) {
  const tmpl = getFamilyTemplate(family);
  if (!tmpl) return { ok: false, reason: `unknown_family:${family}` };
  const violations = [];
  for (const f of files) {
    if (!isFamilyAllowedPath(family, f.path)) {
      violations.push({ path: f.path, reason: "path_not_in_family_whitelist" });
    }
  }
  if (violations.length > 0) return { ok: false, reason: "family_path_mismatch", violations };
  return { ok: true };
}
