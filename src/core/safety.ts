import type { AccessDecision } from "./types.js";

const hardBlockPatterns: Array<{ pattern: RegExp; status: AccessDecision["status"]; reason: string }> = [
  { pattern: /\bcaptcha\b/i, status: "CAPTCHA_OR_VERIFICATION_PAGE", reason: "CAPTCHA text detected." },
  { pattern: /verify you are (?:a )?human/i, status: "CAPTCHA_OR_VERIFICATION_PAGE", reason: "Human verification page detected." },
  { pattern: /checking your browser/i, status: "ACCESS_RESTRICTED", reason: "Browser checking page detected." },
  { pattern: /access denied/i, status: "ACCESS_RESTRICTED", reason: "Access denied page detected." },
  {
    pattern: /access to this page has been denied/i,
    status: "ACCESS_RESTRICTED",
    reason: "Access denied page detected."
  },
  { pattern: /request blocked/i, status: "ACCESS_RESTRICTED", reason: "Request blocked page detected." },
  { pattern: /unusual traffic/i, status: "ACCESS_RESTRICTED", reason: "Unusual traffic warning detected." },
  { pattern: /cloudflare ray id/i, status: "ACCESS_RESTRICTED", reason: "Cloudflare block marker detected." },
  { pattern: /\bforbidden\b|\b403\b/i, status: "ACCESS_RESTRICTED", reason: "Forbidden page detected." },
  { pattern: /bot detection/i, status: "ACCESS_RESTRICTED", reason: "Bot detection page detected." },
  { pattern: /blocked by security/i, status: "ACCESS_RESTRICTED", reason: "Security block page detected." },
  {
    pattern: /triggered a security action/i,
    status: "ACCESS_RESTRICTED",
    reason: "Security block page detected."
  },
  {
    pattern: /do not currently operate in your area/i,
    status: "ACCESS_RESTRICTED",
    reason: "Geographic access restriction detected."
  }
];

export function detectAccessStatus(pageText: string, url: string): AccessDecision {
  const text = pageText.replace(/\s+/g, " ").trim();
  const lowerUrl = url.toLowerCase();

  for (const item of hardBlockPatterns) {
    if (item.pattern.test(text)) {
      return {
        allowed: false,
        status: item.status,
        reason: item.reason
      };
    }
  }

  const loginRoute = /\/(login|signin|sign-in|account|my-account)(\/|$|\?)/i.test(lowerUrl);
  const hasJobContent =
    /\b(job search|job title|job description|salary|location|apply now|date posted|permanent|contract|show results|posted|job type|vacancy|vacancies)\b/i.test(
      text
    );
  const loginOnlyPage =
    /\b(sign in|login|required to login|log in to continue|create an account)\b/i.test(text) &&
    /\b(password|email address|username|authentication)\b/i.test(text) &&
    !hasJobContent;

  if (loginRoute || loginOnlyPage) {
    return {
      allowed: false,
      status: "LOGIN_REQUIRED",
      reason: "Login-only page detected."
    };
  }

  return { allowed: true, status: "ALLOWED" };
}

export function isRestrictedOrCaptchaText(text: string): boolean {
  return !detectAccessStatus(text, "").allowed;
}

export function shouldSkipUrl(url: string): boolean {
  const u = url.toLowerCase();
  const restrictedPatterns = [
    "/login",
    "/signin",
    "/sign-in",
    "/register",
    "/account",
    "/my-account",
    "/apply/",
    "/application/",
    "/checkout",
    "/payment"
  ];

  return restrictedPatterns.some((pattern) => u.includes(pattern));
}
