#!/usr/bin/env python3
"""
=============================================================================
India Public Representatives Scraper
=============================================================================
Sources:
  1. Bihar Vidhan Parishad (MLC) — https://vidhanparishad.bihar.gov.in/member-details-list
  2. Bihar Vidhan Sabha   (MLA) — https://vidhansabha.bihar.gov.in/Knowyourmla.html
  3. Rajya Sabha MPs            — https://sansad.in/rs/members
  4. Lok Sabha MPs              — https://sansad.in/ls/members

Output:
  representatives_master.csv / .xlsx / .json

Usage:
  python representatives_scraper.py               # scrape all sources
  python representatives_scraper.py --source mlc  # scrape one source
  python representatives_scraper.py --dry-run     # test without saving

Author: Senior Web Scraping Engineer
Python: 3.11+
=============================================================================
"""

import re
import csv
import json
import time
import logging
import argparse
import random
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
import pandas as pd

# ── Optional: Playwright for JS-rendered pages ──────────────────────────────
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

# =============================================================================
# CONFIGURATION
# =============================================================================

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)

BASE_DELAY   = 2.0   # seconds between requests
JITTER       = 1.0   # random extra delay (0 – JITTER seconds)
MAX_RETRIES  = 3
TIMEOUT      = 30    # seconds per HTTP request
PW_TIMEOUT   = 60000 # ms for Playwright page loads

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
}

COLUMNS = [
    "Name",
    "Designation",
    "House",
    "Party",
    "State",
    "Constituency",
    "Email IDs",
    "Mobile Numbers",
    "Phone Numbers",
    "Office Numbers",
    "Delhi Address",
    "Constituency Address",
    "Profile URL",
    "Source Website",
    "Notes",
]

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(OUTPUT_DIR / "scraper.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# =============================================================================
# HELPERS — HTTP & DELAY
# =============================================================================

session = requests.Session()
session.headers.update(HEADERS)


def polite_delay(base: float = BASE_DELAY, jitter: float = JITTER) -> None:
    """Sleep between requests to respect rate limits."""
    sleep_for = base + random.uniform(0, jitter)
    log.debug("Sleeping %.2fs …", sleep_for)
    time.sleep(sleep_for)


def fetch_html(url: str, retries: int = MAX_RETRIES, **kwargs) -> Optional[str]:
    """
    GET *url* with retry logic and exponential back-off.
    Returns HTML text or None on failure.
    """
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=TIMEOUT, **kwargs)
            resp.raise_for_status()
            log.info("[HTTP %s] %s", resp.status_code, url)
            return resp.text
        except requests.HTTPError as exc:
            log.warning("Attempt %d/%d HTTP error for %s: %s", attempt, retries, url, exc)
        except requests.RequestException as exc:
            log.warning("Attempt %d/%d request error for %s: %s", attempt, retries, url, exc)
        if attempt < retries:
            wait = 2 ** attempt + random.uniform(0, 1)
            log.info("Retrying in %.1fs …", wait)
            time.sleep(wait)
    log.error("All %d attempts failed for: %s", retries, url)
    return None


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


# =============================================================================
# HELPERS — DATA CLEANING
# =============================================================================

_EMAIL_OBFUSCATIONS = [
    (r"\[dot\]",  "."),
    (r"\[at\]",   "@"),
    (r"\(dot\)",  "."),
    (r"\(at\)",   "@"),
    (r"\s+at\s+", "@"),
    (r"\s+dot\s+", "."),
]
_EMAIL_RE   = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_PHONE_RE   = re.compile(r"[\d\s\-().+]{7,20}")
_MOBILE_RE  = re.compile(r"(?:\+91[\-\s]?)?[6-9]\d{9}")   # Indian mobile
_NONDIGIT   = re.compile(r"[^\d+]")


def clean_email_text(raw: str) -> str:
    """Decode obfuscated email strings."""
    text = raw.strip()
    for pattern, replacement in _EMAIL_OBFUSCATIONS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text.strip()


def extract_emails(text: str) -> list[str]:
    """Extract and validate all email addresses from a string."""
    decoded = clean_email_text(text)
    found   = _EMAIL_RE.findall(decoded)
    return list(dict.fromkeys(e.lower() for e in found))  # dedupe, preserve order


def normalise_phone(raw: str) -> str:
    """Strip formatting from a phone number string."""
    digits = _NONDIGIT.sub("", raw)
    # Drop country code prefix for consistency
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    return digits


def extract_phones(text: str, mobile_only: bool = False) -> list[str]:
    """Extract phone/mobile numbers from free text."""
    pattern = _MOBILE_RE if mobile_only else _PHONE_RE
    raw_hits = pattern.findall(text)
    results  = []
    for hit in raw_hits:
        norm = normalise_phone(hit)
        if len(norm) in (10, 11, 12) and norm not in results:
            results.append(norm)
    return results


def clean_text(val) -> str:
    """Coerce to string and strip extra whitespace."""
    if val is None:
        return ""
    return " ".join(str(val).split()).strip()


def join_unique(*lists) -> str:
    """Flatten multiple lists, deduplicate, return comma-joined string."""
    seen, out = set(), []
    for lst in lists:
        for item in lst:
            if item and item not in seen:
                seen.add(item)
                out.append(item)
    return ", ".join(out)


def blank_record(extra: dict | None = None) -> dict:
    """Return an empty record with all required columns."""
    rec = {col: "" for col in COLUMNS}
    if extra:
        rec.update(extra)
    return rec


# =============================================================================
# SCRAPER 1 — Bihar Vidhan Parishad (MLC)
# =============================================================================

MLC_BASE    = "https://vidhanparishad.bihar.gov.in"
MLC_LIST    = f"{MLC_BASE}/member-details-list"


def scrape_bihar_mlc() -> list[dict]:
    """
    Scrape MLC member list from Bihar Vidhan Parishad.

    Structure (as of 2025):
      • Listing page has a table / card list of members.
      • Each row/card has: Name, Constituency/Category, Party.
      • A "View" / profile link leads to individual detail pages with
        address, email, phone.

    CSS selectors to update if site changes:
      • Member rows  : "table.members-table tbody tr"   or  ".member-card"
      • Name cell    : "td:nth-child(1) a"
      • Profile link : "td:nth-child(1) a[href]"
      • Party cell   : "td:nth-child(3)"
      • Constituency : "td:nth-child(2)"

      On detail page:
        • Email  : ".member-email", "a[href^='mailto:']"
        • Phone  : ".member-phone", ".member-contact"
        • Address: ".member-address", ".addr-block"
    """
    log.info("=== Scraping Bihar Vidhan Parishad (MLC) ===")
    records = []

    html = fetch_html(MLC_LIST)
    if not html:
        log.error("Could not load MLC listing page.")
        return records

    page = soup(html)

    # ── Try table layout first ────────────────────────────────────────────────
    # Selector: update "table.members-table" if the class name changes
    rows = page.select("table.members-table tbody tr")
    if not rows:
        # Fallback: any table on the page
        rows = page.select("table tbody tr")

    # ── Fallback: card / div layout ──────────────────────────────────────────
    if not rows:
        rows = page.select(".member-card, .member-item, .member-row")

    log.info("Found %d MLC row(s) on listing page.", len(rows))

    for row in rows:
        rec = blank_record()
        rec["Designation"]    = "MLC"
        rec["House"]          = "Bihar Vidhan Parishad"
        rec["State"]          = "Bihar"
        rec["Source Website"] = MLC_BASE

        # ── Extract cells (adjust nth-child indices if columns differ) ────────
        cells = row.find_all("td")
        if len(cells) >= 3:
            link_tag      = cells[0].find("a")
            rec["Name"]   = clean_text(link_tag or cells[0])
            profile_href  = link_tag["href"] if link_tag and link_tag.has_attr("href") else ""
            rec["Constituency"] = clean_text(cells[1])
            rec["Party"]        = clean_text(cells[2])
        elif len(cells) >= 2:
            link_tag     = cells[0].find("a")
            rec["Name"]  = clean_text(link_tag or cells[0])
            profile_href = link_tag["href"] if link_tag and link_tag.has_attr("href") else ""
            rec["Party"] = clean_text(cells[1])
        else:
            # Card layout
            link_tag     = row.find("a")
            rec["Name"]  = clean_text(row.select_one(".name, .member-name, h3, h4") or row)
            profile_href = link_tag["href"] if link_tag and link_tag.has_attr("href") else ""
            rec["Party"] = clean_text(row.select_one(".party, .party-name") or "")

        if not profile_href:
            rec["Notes"] = "Profile URL not found on listing page"
            records.append(rec)
            continue

        # Build full URL
        profile_url = profile_href if profile_href.startswith("http") else MLC_BASE + profile_href
        rec["Profile URL"] = profile_url

        # ── Visit detail page ─────────────────────────────────────────────────
        polite_delay()
        detail_html = fetch_html(profile_url)
        if not detail_html:
            rec["Notes"] = "Detail page failed to load"
            records.append(rec)
            continue

        detail = soup(detail_html)
        _parse_member_detail_mlc(detail, rec)
        records.append(rec)
        log.info("  MLC: %s (%s)", rec["Name"], rec["Party"])

    return records


def _parse_member_detail_mlc(detail: BeautifulSoup, rec: dict) -> None:
    """
    Parse a Bihar Vidhan Parishad member detail page.
    Adjust selectors below if the page structure changes.
    """
    full_text = detail.get_text(" ", strip=True)

    # Email — try mailto first, then text scan
    emails = []
    for a in detail.select("a[href^='mailto:']"):
        emails += extract_emails(a["href"].replace("mailto:", ""))
    emails += extract_emails(full_text)
    rec["Email IDs"] = join_unique(emails)

    # Phone / Mobile
    mobiles = extract_phones(full_text, mobile_only=True)
    phones  = [p for p in extract_phones(full_text) if p not in mobiles]
    rec["Mobile Numbers"] = join_unique(mobiles)
    rec["Phone Numbers"]  = join_unique(phones)

    # Address blocks — look for labelled sections
    addr_block = detail.select_one(".member-address, .address-block, .addr, [class*='address']")
    if addr_block:
        addr_text = clean_text(addr_block)
        if re.search(r"delhi|new delhi", addr_text, re.I):
            rec["Delhi Address"] = addr_text
        else:
            rec["Constituency Address"] = addr_text

    # Constituency (detail page may have it too)
    const_el = detail.select_one(".constituency, [class*='constituency'], .member-const")
    if const_el and not rec["Constituency"]:
        rec["Constituency"] = clean_text(const_el)

    # Party override from detail page if richer
    party_el = detail.select_one(".party-name, .member-party, [class*='party']")
    if party_el and not rec["Party"]:
        rec["Party"] = clean_text(party_el)

    # Notes if key fields missing
    missing = []
    for field in ("Email IDs", "Mobile Numbers", "Party", "Constituency"):
        if not rec[field]:
            missing.append(field)
    if missing:
        rec["Notes"] = f"Not found on page: {', '.join(missing)}"


# =============================================================================
# SCRAPER 2 — Bihar Vidhan Sabha (MLA)
# =============================================================================

MLA_BASE   = "https://vidhansabha.bihar.gov.in"
MLA_LIST   = f"{MLA_BASE}/Knowyourmla.html"


def scrape_bihar_mla() -> list[dict]:
    """
    Scrape MLA member list from Bihar Vidhan Sabha.

    Structure (as of 2025):
      • Listing page: alphabetical / constituency dropdown.
      • Table columns: Sr., Constituency, Member Name, Party, Phone/Email.
      • Individual profile pages reachable via member name link.

    CSS selectors to update if site changes:
      • Table rows   : "table#memberTable tbody tr"   or  "table.table tbody tr"
      • Name / link  : "td:nth-child(3) a"
      • Constituency : "td:nth-child(2)"
      • Party        : "td:nth-child(4)"
      • Phone/Email  : "td:nth-child(5)"

      On detail page (if applicable):
        • Same pattern as MLC detail page above.
    """
    log.info("=== Scraping Bihar Vidhan Sabha (MLA) ===")
    records = []

    html = fetch_html(MLA_LIST)
    if not html:
        # Try Playwright for JS-rendered page
        if PLAYWRIGHT_AVAILABLE:
            log.info("Falling back to Playwright for MLA listing …")
            html = _pw_fetch(MLA_LIST)
        if not html:
            log.error("Could not load MLA listing page.")
            return records

    page = soup(html)

    # ── Primary selector: named table ─────────────────────────────────────────
    rows = page.select("table#memberTable tbody tr, table#MemberTable tbody tr")
    if not rows:
        rows = page.select("table.table tbody tr, table tbody tr")

    log.info("Found %d MLA row(s) on listing page.", len(rows))

    for row in rows:
        rec = blank_record()
        rec["Designation"]    = "MLA"
        rec["House"]          = "Bihar Vidhan Sabha"
        rec["State"]          = "Bihar"
        rec["Source Website"] = MLA_BASE

        cells = row.find_all("td")
        if len(cells) < 3:
            continue  # skip header-like rows

        # Column order: Sr | Constituency | Name | Party | Phone | Email
        # Adjust indices if the table structure differs
        if len(cells) >= 6:
            sr_idx, const_idx, name_idx, party_idx, phone_idx, email_idx = 0, 1, 2, 3, 4, 5
        elif len(cells) >= 4:
            sr_idx, const_idx, name_idx, party_idx = 0, 1, 2, 3
            phone_idx, email_idx = None, None
        else:
            name_idx, party_idx = 0, 1
            const_idx, phone_idx, email_idx = None, None, None

        link_tag = cells[name_idx].find("a")
        rec["Name"]         = clean_text(link_tag or cells[name_idx])
        rec["Party"]        = clean_text(cells[party_idx]) if party_idx is not None else ""
        rec["Constituency"] = clean_text(cells[const_idx]) if const_idx is not None else ""

        # In-table phone / email
        if phone_idx is not None and phone_idx < len(cells):
            rec["Phone Numbers"] = join_unique(extract_phones(cells[phone_idx].get_text()))
        if email_idx is not None and email_idx < len(cells):
            rec["Email IDs"] = join_unique(extract_emails(cells[email_idx].get_text()))

        # Profile link
        profile_href = ""
        if link_tag and link_tag.has_attr("href"):
            profile_href = link_tag["href"]
        if profile_href:
            profile_url = profile_href if profile_href.startswith("http") else MLA_BASE + "/" + profile_href.lstrip("/")
            rec["Profile URL"] = profile_url

            polite_delay()
            detail_html = fetch_html(profile_url)
            if detail_html:
                _parse_member_detail_mla(soup(detail_html), rec)
            else:
                rec["Notes"] = "Detail page failed to load"
        else:
            rec["Notes"] = "Profile URL not found; used listing-page data only"

        records.append(rec)
        log.info("  MLA: %s — %s (%s)", rec["Name"], rec["Constituency"], rec["Party"])

    return records


def _parse_member_detail_mla(detail: BeautifulSoup, rec: dict) -> None:
    """
    Parse a Bihar Vidhan Sabha member profile page.
    Same pattern as MLC but separate function for easy selector overrides.

    Key selectors (update if site structure changes):
      • Email  : "a[href^='mailto:']",  ".email-id", ".contact-email"
      • Mobile : ".mobile-no",  ".cell-no",  "[class*='mobile']"
      • Phone  : ".phone-no",   "[class*='phone']"
      • Address: ".address",    ".member-address", "address"
      • Party  : ".party-name", "[class*='party']"
    """
    full_text = detail.get_text(" ", strip=True)

    # Email
    emails = []
    for a in detail.select("a[href^='mailto:']"):
        emails += extract_emails(a["href"].replace("mailto:", ""))
    emails += extract_emails(full_text)
    if emails:
        rec["Email IDs"] = join_unique(extract_emails(rec["Email IDs"]), emails)

    # Mobile / Phone
    mobiles = extract_phones(full_text, mobile_only=True)
    phones  = [p for p in extract_phones(full_text) if p not in mobiles]
    if mobiles:
        rec["Mobile Numbers"] = join_unique(extract_phones(rec.get("Mobile Numbers",""), mobile_only=True), mobiles)
    if phones:
        rec["Phone Numbers"] = join_unique(extract_phones(rec.get("Phone Numbers","")), phones)

    # Address blocks
    for addr_el in detail.select(".address, .member-address, address, [class*='addr']"):
        addr_text = clean_text(addr_el)
        if not addr_text:
            continue
        if re.search(r"new delhi|delhi", addr_text, re.I):
            if not rec["Delhi Address"]:
                rec["Delhi Address"] = addr_text
        else:
            if not rec["Constituency Address"]:
                rec["Constituency Address"] = addr_text

    # Party override
    party_el = detail.select_one(".party-name, [class*='party']")
    if party_el and not rec["Party"]:
        rec["Party"] = clean_text(party_el)

    # Constituency override
    const_el = detail.select_one(".constituency, [class*='constituency']")
    if const_el and not rec["Constituency"]:
        rec["Constituency"] = clean_text(const_el)

    missing = [f for f in ("Email IDs", "Mobile Numbers", "Party") if not rec[f]]
    if missing:
        existing_note = rec.get("Notes", "")
        rec["Notes"] = (existing_note + "; " if existing_note else "") + f"Not found: {', '.join(missing)}"


# =============================================================================
# SCRAPER 3 — Rajya Sabha Members
# =============================================================================

RS_BASE     = "https://sansad.in"
RS_LIST     = f"{RS_BASE}/rs/members"
RS_API      = f"{RS_BASE}/api/rs/members"           # JSON API endpoint (if available)
RS_PROFILE  = f"{RS_BASE}/rs/members/member-bio-data"


def scrape_rajya_sabha() -> list[dict]:
    """
    Scrape Rajya Sabha member list from sansad.in.

    Structure (as of 2025):
      • The page is React/Angular rendered — Playwright required.
      • Filter panel: State, Party, Gender.
      • Member cards: Name, Party, State, Constituency (State for RS).
      • Profile links: /rs/members/member-bio-data?mpsno=XXXX
      • Detail page has: Photo, Address, Email, Phone, DOB, Qualification, etc.

    Selectors (update if site changes):
      Listing:
        • Member cards  : ".member-card", ".rs-member-card", "[class*='MemberCard']"
        • Name          : ".member-name h3", ".name", "h3"
        • Party         : ".party",  "[class*='party']"
        • State         : ".state",  "[class*='state']"
        • Profile link  : "a[href*='member-bio-data']"

      Detail page:
        • Email         : "a[href^='mailto:']",  ".email-id"
        • Phone         : ".phone",   "[class*='phone']"
        • Delhi addr    : section containing "New Delhi" text
        • Const addr    : section containing home state text
    """
    log.info("=== Scraping Rajya Sabha Members ===")
    records = []

    if not PLAYWRIGHT_AVAILABLE:
        log.error("Playwright not installed; Rajya Sabha page requires JS rendering.")
        log.error("Install: pip install playwright && playwright install chromium")
        return records

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=HEADERS["User-Agent"],
            locale="en-IN",
        )
        page = context.new_page()

        log.info("Loading Rajya Sabha listing page …")
        try:
            page.goto(RS_LIST, wait_until="networkidle", timeout=PW_TIMEOUT)
        except PWTimeout:
            log.warning("Page load timed-out; proceeding with partial content.")

        # Wait for member cards to appear
        # Update selector ".member-card" if class name changes
        try:
            page.wait_for_selector(".member-card, [class*='MemberCard'], .rs-member", timeout=20000)
        except PWTimeout:
            log.warning("Member cards did not appear within timeout; trying anyway …")

        # Scroll to bottom to trigger lazy loading
        _scroll_to_bottom(page)

        html      = page.content()
        page_soup = soup(html)

        # ── Parse member cards ────────────────────────────────────────────────
        # Try multiple possible class patterns
        cards = (
            page_soup.select(".member-card") or
            page_soup.select("[class*='MemberCard']") or
            page_soup.select(".rs-member") or
            page_soup.select("[class*='member']")
        )
        log.info("Found %d Rajya Sabha card(s) on listing page.", len(cards))

        profile_links = []
        for card in cards:
            rec = blank_record()
            rec["Designation"]    = "Rajya Sabha MP"
            rec["House"]          = "Rajya Sabha"
            rec["Source Website"] = RS_BASE

            name_el = card.select_one("h3, h4, .name, .member-name, [class*='Name']")
            rec["Name"]  = clean_text(name_el) if name_el else clean_text(card)

            party_el = card.select_one(".party, [class*='party'], [class*='Party']")
            rec["Party"] = clean_text(party_el)

            state_el = card.select_one(".state, [class*='state'], [class*='State']")
            rec["State"] = clean_text(state_el) or "Various"  # RS members represent states

            # Profile link
            link = card.find("a", href=re.compile(r"member-bio-data|bio-data|profile"))
            if not link:
                link = card.find("a")
            if link and link.get("href"):
                href = link["href"]
                full_url = href if href.startswith("http") else RS_BASE + href
                rec["Profile URL"] = full_url
                profile_links.append((rec, full_url))
            else:
                rec["Notes"] = "Profile link not found on card"
                records.append(rec)

        # ── Visit each profile page ───────────────────────────────────────────
        for rec, profile_url in profile_links:
            try:
                page.goto(profile_url, wait_until="networkidle", timeout=PW_TIMEOUT)
                # Wait for detail content
                try:
                    page.wait_for_selector(".member-detail, .bio-data, .contact-info, main", timeout=15000)
                except PWTimeout:
                    pass

                detail_html  = page.content()
                detail       = soup(detail_html)
                _parse_member_detail_rs(detail, rec)
                log.info("  RS: %s — %s (%s)", rec["Name"], rec["State"], rec["Party"])
            except Exception as exc:
                log.warning("Error on RS profile %s: %s", profile_url, exc)
                rec["Notes"] = f"Profile page error: {exc}"

            records.append(rec)
            polite_delay()

        browser.close()

    return records


def _parse_member_detail_rs(detail: BeautifulSoup, rec: dict) -> None:
    """
    Parse a Rajya Sabha member bio-data page.

    Key selectors (update if site structure changes):
      • Email        : "a[href^='mailto:']",  ".email",  "[class*='email']"
      • Phone        : ".phone",   "[class*='phone']",  "[class*='Phone']"
      • Delhi addr   : ".delhi-addr",  section with "New Delhi" keyword
      • Const addr   : ".constituency-addr", section with state name
      • Constituency : ".constituency",  "[class*='Constituency']"
      • Party        : ".party-name",    "[class*='party']"
    """
    full_text = detail.get_text(" ", strip=True)

    # Email
    emails = []
    for a in detail.select("a[href^='mailto:']"):
        emails += extract_emails(a["href"].replace("mailto:", ""))
    emails += extract_emails(full_text)
    rec["Email IDs"] = join_unique(emails)

    # Mobile / Phone
    mobiles = extract_phones(full_text, mobile_only=True)
    phones  = [p for p in extract_phones(full_text) if p not in mobiles]
    rec["Mobile Numbers"] = join_unique(mobiles)
    rec["Phone Numbers"]  = join_unique(phones)

    # Office number — look for "office" label
    office_match = re.search(r"(?:office|off\.?)[^\d]*(\d[\d\s\-]{6,14}\d)", full_text, re.I)
    if office_match:
        rec["Office Numbers"] = normalise_phone(office_match.group(1))

    # Addresses — split by Delhi vs. home
    for section in detail.select("address, .address, [class*='address'], [class*='Address']"):
        text = clean_text(section)
        if not text:
            continue
        if re.search(r"new delhi|110\d{3}", text, re.I):
            if not rec["Delhi Address"]:
                rec["Delhi Address"] = text
        else:
            if not rec["Constituency Address"]:
                rec["Constituency Address"] = text

    # State (detail page may have it)
    state_el = detail.select_one("[class*='state'], [class*='State']")
    if state_el and not rec["State"]:
        rec["State"] = clean_text(state_el)

    # Constituency
    const_el = detail.select_one("[class*='constituency'], [class*='Constituency'], .constituency")
    if const_el:
        rec["Constituency"] = clean_text(const_el)

    # Party override
    party_el = detail.select_one("[class*='party'], [class*='Party'], .party-name")
    if party_el and not rec["Party"]:
        rec["Party"] = clean_text(party_el)

    missing = [f for f in ("Email IDs", "Party", "State") if not rec[f]]
    if missing:
        rec["Notes"] = f"Not found: {', '.join(missing)}"


# =============================================================================
# SCRAPER 4 — Lok Sabha Members
# =============================================================================

LS_BASE    = "https://sansad.in"
LS_LIST    = f"{LS_BASE}/ls/members"
LS_PROFILE = f"{LS_BASE}/ls/members/member-bio-data"


def scrape_lok_sabha() -> list[dict]:
    """
    Scrape Lok Sabha member list from sansad.in.

    Structure (as of 2025):
      • JavaScript-rendered (Next.js / React) — Playwright required.
      • Filter panel: State, Party, Gender, Profession.
      • Member cards: Name, Party, State, Constituency.
      • Profile links: /ls/members/member-bio-data?mpsno=XXXX

    Selectors (update if site changes):
      Listing:
        • Member cards  : ".member-card", "[class*='MemberCard']"
        • Name          : "h3", ".name", "[class*='Name']"
        • Party         : ".party", "[class*='party']"
        • State         : ".state", "[class*='state']"
        • Constituency  : ".constituency", "[class*='constituency']"
        • Profile link  : "a[href*='member-bio-data']"

      Detail page:
        Same as Rajya Sabha detail parsing (_parse_member_detail_rs is reused,
        but override House = "Lok Sabha" and Designation = "Lok Sabha MP").
    """
    log.info("=== Scraping Lok Sabha Members ===")
    records = []

    if not PLAYWRIGHT_AVAILABLE:
        log.error("Playwright not installed; Lok Sabha page requires JS rendering.")
        log.error("Install: pip install playwright && playwright install chromium")
        return records

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=HEADERS["User-Agent"],
            locale="en-IN",
        )
        page = context.new_page()

        log.info("Loading Lok Sabha listing page …")
        try:
            page.goto(LS_LIST, wait_until="networkidle", timeout=PW_TIMEOUT)
        except PWTimeout:
            log.warning("LS page load timed-out; proceeding with partial content.")

        try:
            page.wait_for_selector(".member-card, [class*='MemberCard'], .ls-member", timeout=20000)
        except PWTimeout:
            log.warning("LS member cards did not appear; trying anyway …")

        _scroll_to_bottom(page)
        html      = page.content()
        page_soup = soup(html)

        cards = (
            page_soup.select(".member-card") or
            page_soup.select("[class*='MemberCard']") or
            page_soup.select(".ls-member") or
            page_soup.select("[class*='member']")
        )
        log.info("Found %d Lok Sabha card(s) on listing page.", len(cards))

        profile_links = []
        for card in cards:
            rec = blank_record()
            rec["Designation"]    = "Lok Sabha MP"
            rec["House"]          = "Lok Sabha"
            rec["Source Website"] = LS_BASE

            name_el  = card.select_one("h3, h4, .name, .member-name, [class*='Name']")
            rec["Name"] = clean_text(name_el) if name_el else clean_text(card)

            party_el = card.select_one(".party, [class*='party'], [class*='Party']")
            rec["Party"] = clean_text(party_el)

            state_el = card.select_one(".state, [class*='state'], [class*='State']")
            rec["State"] = clean_text(state_el)

            const_el = card.select_one(".constituency, [class*='constituency'], [class*='Constituency']")
            rec["Constituency"] = clean_text(const_el)

            link = card.find("a", href=re.compile(r"member-bio-data|bio-data|profile"))
            if not link:
                link = card.find("a")
            if link and link.get("href"):
                href = link["href"]
                full_url = href if href.startswith("http") else LS_BASE + href
                rec["Profile URL"] = full_url
                profile_links.append((rec, full_url))
            else:
                rec["Notes"] = "Profile link not found on card"
                records.append(rec)

        # ── Visit each profile page ───────────────────────────────────────────
        for rec, profile_url in profile_links:
            try:
                page.goto(profile_url, wait_until="networkidle", timeout=PW_TIMEOUT)
                try:
                    page.wait_for_selector(".member-detail, .bio-data, .contact-info, main", timeout=15000)
                except PWTimeout:
                    pass

                detail_html = page.content()
                detail      = soup(detail_html)

                # Reuse RS parser (same sansad.in platform); override fields after
                _parse_member_detail_rs(detail, rec)
                log.info("  LS: %s — %s / %s (%s)", rec["Name"], rec["Constituency"], rec["State"], rec["Party"])
            except Exception as exc:
                log.warning("Error on LS profile %s: %s", profile_url, exc)
                rec["Notes"] = f"Profile page error: {exc}"

            records.append(rec)
            polite_delay()

        browser.close()

    return records


# =============================================================================
# PLAYWRIGHT UTILITY — Scroll to load all lazy content
# =============================================================================

def _scroll_to_bottom(page, pause: float = 1.5, max_scrolls: int = 30) -> None:
    """Gradually scroll to the bottom to trigger infinite scroll / lazy loading."""
    prev_height = 0
    for _ in range(max_scrolls):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(pause)
        new_height = page.evaluate("document.body.scrollHeight")
        if new_height == prev_height:
            break
        prev_height = new_height


def _pw_fetch(url: str) -> Optional[str]:
    """Fetch a page using Playwright (headless Chromium) and return HTML."""
    if not PLAYWRIGHT_AVAILABLE:
        return None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page    = browser.new_page(user_agent=HEADERS["User-Agent"])
            page.goto(url, wait_until="networkidle", timeout=PW_TIMEOUT)
            html = page.content()
            browser.close()
            return html
    except Exception as exc:
        log.error("Playwright fetch failed for %s: %s", url, exc)
        return None


# =============================================================================
# DEDUPLICATION
# =============================================================================

def deduplicate(records: list[dict]) -> list[dict]:
    """
    Remove exact-duplicate rows.
    If the same person has the same email across multiple sources, merge phones.
    Different roles for the same person → kept as separate rows (per spec).
    """
    log.info("Deduplicating %d records …", len(records))
    seen: dict[tuple, dict] = {}

    for rec in records:
        # Key: name + house (different roles = different rows)
        key = (
            clean_text(rec["Name"]).lower(),
            clean_text(rec["House"]).lower(),
        )
        if key not in seen:
            seen[key] = rec.copy()
        else:
            # Merge contact fields if the same person appears twice
            existing = seen[key]
            for field in ("Email IDs", "Mobile Numbers", "Phone Numbers", "Office Numbers"):
                combined = join_unique(
                    existing[field].split(", "),
                    rec[field].split(", "),
                )
                existing[field] = combined
            # Supplement any blank fields
            for field in COLUMNS:
                if not existing[field] and rec[field]:
                    existing[field] = rec[field]

    result = list(seen.values())
    log.info("After deduplication: %d records.", len(result))
    return result


# =============================================================================
# EXPORT
# =============================================================================

def export(records: list[dict], stem: str = "representatives_master") -> None:
    """Save records to CSV, XLSX, and JSON."""
    df = pd.DataFrame(records, columns=COLUMNS)

    # ── CSV ──────────────────────────────────────────────────────────────────
    csv_path = OUTPUT_DIR / f"{stem}.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    log.info("Saved CSV  → %s  (%d rows)", csv_path, len(df))

    # ── XLSX ─────────────────────────────────────────────────────────────────
    xlsx_path = OUTPUT_DIR / f"{stem}.xlsx"
    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Representatives")

        # Auto-fit column widths
        ws = writer.sheets["Representatives"]
        for col in ws.columns:
            max_len = max(
                len(str(cell.value)) if cell.value else 0
                for cell in col
            )
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 60)

    log.info("Saved XLSX → %s", xlsx_path)

    # ── JSON ─────────────────────────────────────────────────────────────────
    json_path = OUTPUT_DIR / f"{stem}.json"
    json_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    log.info("Saved JSON → %s", json_path)


# =============================================================================
# MAIN ORCHESTRATOR
# =============================================================================

SCRAPERS = {
    "mlc": scrape_bihar_mlc,
    "mla": scrape_bihar_mla,
    "rs":  scrape_rajya_sabha,
    "ls":  scrape_lok_sabha,
}


def main(sources: list[str] | None = None, dry_run: bool = False) -> None:
    sources = sources or list(SCRAPERS.keys())
    all_records: list[dict] = []

    for src in sources:
        if src not in SCRAPERS:
            log.warning("Unknown source: %s — skipping.", src)
            continue
        try:
            batch = SCRAPERS[src]()
            log.info("Collected %d record(s) from '%s'.", len(batch), src)
            all_records.extend(batch)
        except Exception as exc:
            log.error("Scraper '%s' failed: %s", src, exc, exc_info=True)

    if not all_records:
        log.warning("No records collected. Check network access and selectors.")
        return

    final = deduplicate(all_records)

    if dry_run:
        log.info("[DRY RUN] Would export %d records. Not saving.", len(final))
        for r in final[:5]:
            log.info("  Sample: %s | %s | %s", r["Name"], r["House"], r["Party"])
    else:
        export(final)
        log.info("✅  Done. Output in: %s/", OUTPUT_DIR)


# =============================================================================
# CLI ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape Indian public representatives from official websites."
    )
    parser.add_argument(
        "--source",
        choices=list(SCRAPERS.keys()),
        nargs="+",
        help="Which source(s) to scrape (default: all). Choices: mlc mla rs ls",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run scrapers but do not write output files.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=BASE_DELAY,
        help=f"Base delay in seconds between requests (default: {BASE_DELAY})",
    )
    args = parser.parse_args()

    # Apply CLI delay override
    BASE_DELAY = args.delay

    main(sources=args.source, dry_run=args.dry_run)