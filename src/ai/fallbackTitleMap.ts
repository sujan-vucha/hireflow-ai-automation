import type { ExpandedTitle } from "../core/types.js";
import { normalizeText } from "../core/normalize.js";

const fallbackMap: Record<string, string[]> = {
  "digital marketing": [
    "Digital Marketing Manager",
    "Digital Marketing Executive",
    "Performance Marketing Manager",
    "Paid Media Manager",
    "PPC Manager",
    "SEO Manager",
    "Growth Marketing Manager",
    "Acquisition Marketing Manager",
    "Demand Generation Manager",
    "CRM Marketing Manager",
    "Lifecycle Marketing Manager",
    "Marketing Automation Manager",
    "Ecommerce Marketing Manager",
    "Social Media Manager",
    "Content Marketing Manager",
    "Digital Campaign Manager",
    "Marketing Analytics Manager"
  ],
  "performance marketing": ["Performance Marketing Manager", "Paid Media Manager", "PPC Manager", "Growth Marketing Manager"],
  seo: ["SEO Manager", "SEO Executive", "Technical SEO Manager", "Content SEO Manager"],
  ppc: ["PPC Manager", "Paid Search Manager", "Paid Media Manager", "Performance Marketing Manager"],
  "paid media": ["Paid Media Manager", "Paid Social Manager", "Paid Search Manager", "Performance Marketing Manager"],
  "growth marketing": ["Growth Marketing Manager", "Acquisition Marketing Manager", "Demand Generation Manager"],
  "marketing analytics": ["Marketing Analytics Manager", "Digital Analyst", "Web Analytics Manager"],
  "crm marketing": ["CRM Marketing Manager", "Lifecycle Marketing Manager", "Email Marketing Manager"],
  "ecommerce marketing": ["Ecommerce Marketing Manager", "Digital Trading Manager", "Marketplace Manager"],
  "social media marketing": ["Social Media Manager", "Social Media Executive", "Paid Social Manager"],
  "content marketing": ["Content Marketing Manager", "Content Manager", "Digital Content Manager"],
  "data analyst": ["Data Analyst", "BI Analyst", "Reporting Analyst", "Marketing Analyst"],
  "business analyst": ["Business Analyst", "Digital Business Analyst", "Product Business Analyst"],
  "product manager": ["Product Manager", "Digital Product Manager", "Product Owner"],
  "project manager": ["Project Manager", "Digital Project Manager", "Delivery Manager"],
  "software developer": ["Software Developer", "Software Engineer", "Backend Developer"],
  "full stack developer": ["Full Stack Developer", "Full Stack Engineer", "React Developer", "Node.js Developer"]
};

export const defaultNegativeTitles = [
  "Door to Door Sales",
  "Field Sales Executive",
  "Call Centre Agent",
  "Warehouse Operative",
  "Admin Assistant",
  "Retail Assistant",
  "Finance Manager"
];

function categoryFor(title: string): string {
  const lower = title.toLowerCase();
  if (/\bppc|paid search\b/.test(lower)) return "PPC";
  if (/\bpaid media|paid social|performance\b/.test(lower)) return "Paid Media / Acquisition";
  if (/\bseo\b/.test(lower)) return "SEO";
  if (/\bgrowth|acquisition|demand generation\b/.test(lower)) return "Growth";
  if (/\bcrm|lifecycle|email|automation\b/.test(lower)) return "CRM";
  if (/\banalytics|analyst|data\b/.test(lower)) return "Analytics";
  if (/\bcontent\b/.test(lower)) return "Content";
  if (/\bsocial\b/.test(lower)) return "Social Media";
  if (/\becommerce|e-commerce|marketplace\b/.test(lower)) return "Ecommerce";
  return "General Digital Marketing";
}

export function fallbackExpandedTitles(originalTitle: string, maxExpandedTitles: number): ExpandedTitle[] {
  const key = normalizeText(originalTitle).toLowerCase();
  const exact = fallbackMap[key];
  const matched = exact || Object.entries(fallbackMap).find(([mapKey]) => key.includes(mapKey) || mapKey.includes(key))?.[1] || [];
  return matched.slice(0, maxExpandedTitles).map((title, index) => ({
    title,
    category: categoryFor(title),
    priority: index + 1,
    reason: `Static fallback title related to ${originalTitle}.`
  }));
}
