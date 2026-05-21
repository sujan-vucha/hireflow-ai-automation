import type { SiteAdapter } from "../core/types.js";
import { adeccoAdapter } from "../adapters/adecco.adapter.js";
import { haysAdapter } from "../adapters/hays.adapter.js";
import { huntressAdapter } from "../adapters/huntress.adapter.js";
import { jacAdapter } from "../adapters/jac.adapter.js";
import { kornFerryAdapter } from "../adapters/kornferry.adapter.js";
import { manpowerAdapter } from "../adapters/manpower.adapter.js";
import { michaelPageAdapter } from "../adapters/michaelpage.adapter.js";
import { morganHuntAdapter } from "../adapters/morganhunt.adapter.js";
import { pageExecutiveAdapter } from "../adapters/pageexecutive.adapter.js";
import { propelAdapter } from "../adapters/propel.adapter.js";
import { randstadAdapter } from "../adapters/randstad.adapter.js";
import { reedAdapter } from "../adapters/reed.adapter.js";
import { robertHalfAdapter } from "../adapters/roberthalf.adapter.js";
import { robertWaltersAdapter } from "../adapters/robertwalters.adapter.js";
import { tigerAdapter } from "../adapters/tiger.adapter.js";

export const adapters: SiteAdapter[] = [
  haysAdapter,
  michaelPageAdapter,
  reedAdapter,
  randstadAdapter,
  robertWaltersAdapter,
  adeccoAdapter,
  manpowerAdapter,
  robertHalfAdapter,
  pageExecutiveAdapter,
  kornFerryAdapter,
  tigerAdapter,
  morganHuntAdapter,
  huntressAdapter,
  jacAdapter,
  propelAdapter
];

export function getAdapter(siteId: string): SiteAdapter | undefined {
  const normalized = siteId.toLowerCase().replace(/[-_\s]/g, "");
  return adapters.find((adapter) => adapter.siteId.toLowerCase().replace(/[-_\s]/g, "") === normalized);
}
