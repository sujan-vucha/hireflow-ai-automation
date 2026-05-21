import "dotenv/config";
import type { ExpandedTitle, TitleExpansionReport } from "../core/types.js";
import { normalizeText } from "../core/normalize.js";
import { getAIProvider } from "./aiProviderManager.js";
import { defaultNegativeTitles, fallbackExpandedTitles } from "./fallbackTitleMap.js";

type AIExpansion = {
  originalTitle: string;
  expandedTitles: ExpandedTitle[];
  negativeTitles: string[];
};

function cleanExpandedTitles(originalTitle: string, titles: ExpandedTitle[], maxExpandedTitles: number): ExpandedTitle[] {
  const seen = new Set<string>();
  return titles
    .map((item, index) => ({
      title: normalizeText(item.title),
      category: normalizeText(item.category) || "General Digital Marketing",
      priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : index + 1,
      reason: normalizeText(item.reason) || `Related to ${originalTitle}.`
    }))
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (!item.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxExpandedTitles);
}

function expansionPrompt(originalTitle: string, maxExpandedTitles: number): string {
  return [
    "You generate UK recruitment job search titles.",
    "Return only strict JSON. Do not include markdown.",
    "",
    "Rules:",
    "- Generate realistic UK recruitment job titles.",
    "- Include seniority variations when useful.",
    "- Do not generate irrelevant titles.",
    "- Prioritise titles used by recruitment agencies.",
    "- Do not invent jobs. These are search terms only.",
    `- Limit expandedTitles to ${maxExpandedTitles}.`,
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        originalTitle,
        expandedTitles: [
          {
            title: "Performance Marketing Manager",
            category: "Paid Media / Acquisition",
            priority: 1,
            reason:
              "Closely related because it focuses on paid acquisition, campaign optimisation, and performance analytics."
          }
        ],
        negativeTitles: defaultNegativeTitles
      },
      null,
      2
    ),
    "",
    `Original title: ${originalTitle}`
  ].join("\n");
}

export async function expandJobTitle(originalTitle: string, maxExpandedTitles = 20, forceFallback = false): Promise<TitleExpansionReport> {
  if (forceFallback) {
    return {
      originalTitle,
      expandedTitles: fallbackExpandedTitles(originalTitle, maxExpandedTitles),
      negativeTitles: defaultNegativeTitles,
      providerUsed: "fallback",
      fallbackAIUsed: true,
      ollamaAvailable: false
    };
  }

  const providerStatus = await getAIProvider();
  if (providerStatus.provider) {
    try {
      const parsed = await providerStatus.provider.generateJson<AIExpansion>(expansionPrompt(originalTitle, maxExpandedTitles), {
        temperature: 0.15,
        maxTokens: 1600
      });
      const expandedTitles = cleanExpandedTitles(originalTitle, parsed.expandedTitles || [], maxExpandedTitles);
      if (expandedTitles.length > 0) {
        return {
          originalTitle,
          expandedTitles,
          negativeTitles: Array.isArray(parsed.negativeTitles) ? parsed.negativeTitles.map(normalizeText).filter(Boolean) : defaultNegativeTitles,
          providerUsed: "ollama",
          fallbackAIUsed: false,
          ollamaAvailable: true
        };
      }
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  return {
    originalTitle,
    expandedTitles: fallbackExpandedTitles(originalTitle, maxExpandedTitles),
    negativeTitles: defaultNegativeTitles,
    providerUsed: "fallback",
    fallbackAIUsed: true,
    ollamaAvailable: providerStatus.ollamaAvailable
  };
}

if (process.argv[1]?.endsWith("titleExpander.ts")) {
  const title = process.argv.slice(2).join(" ") || "Digital Marketing";
  expandJobTitle(title, Number(process.env.MAX_EXPANDED_TITLES || 20))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
