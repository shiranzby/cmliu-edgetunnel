import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFIP_PAGE = 'https://v2rayssr.com/cfip/';
const OUT_FILE = fileURLToPath(new URL('../data/cfip.json', import.meta.url));
const COUNTRY_API_TIMEOUT_MS = 4500;
const COUNTRY_CONCURRENCY = 6;
const MAX_ROWS = 50;

const countryNameMap = {
  US: '美国',
  JP: '日本',
  SG: '新加坡',
  DE: '德国',
  NL: '荷兰',
  HK: '中国香港',
  TW: '中国台湾',
  KR: '韩国',
  GB: '英国',
  FR: '法国',
  CA: '加拿大',
  AU: '澳大利亚',
  IN: '印度',
  RU: '俄罗斯',
  BR: '巴西',
  MX: '墨西哥',
  IT: '意大利',
  ES: '西班牙',
  SE: '瑞典',
  CH: '瑞士',
};

const htmlDecode = (value) => String(value || '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'ShyVPN-CFIP-Updater/1.0',
        accept: 'text/html,application/json,text/plain,*/*',
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseCfipTable(html) {
  const rows = [];
  const rowRegex = /<tr>\s*<td>(?<rank>\d+)<\/td>\s*<td><span class="cfip-line-(?<line>[^"]+)">[^<]+<\/span><\/td>\s*<td[^>]*>(?<ip>(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)<div[\s\S]*?<\/td>\s*<td>(?<loss>[^<]+)<\/td>\s*<td>(?<latency>[^<]+)<\/td>\s*<td>(?<speed>[^<]+)<\/td>\s*<td>(?<bandwidth>[^<]+)<\/td>[\s\S]*?<td>(?<updated>[^<]+)<\/td>/g;
  for (const match of html.matchAll(rowRegex)) {
    rows.push({
      rank: Number(match.groups.rank),
      line: htmlDecode(match.groups.line).replace(/^ipv6$/i, 'IPV6'),
      ip: htmlDecode(match.groups.ip),
      port: 443,
      loss: htmlDecode(match.groups.loss),
      latency: htmlDecode(match.groups.latency),
      speed: htmlDecode(match.groups.speed).replace(/mb\/s/i, 'm/s'),
      bandwidth: htmlDecode(match.groups.bandwidth),
      updated: htmlDecode(match.groups.updated),
      source: CFIP_PAGE,
    });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

async function lookupCountry(ip) {
  const apis = [
    `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,country`,
    `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,country`,
  ];
  for (const api of apis) {
    try {
      const text = await fetchText(api, COUNTRY_API_TIMEOUT_MS);
      const data = JSON.parse(text);
      const code = String(data.country_code || data.countryCode || '').toUpperCase();
      const country = countryNameMap[code] || data.country || '';
      if (country) return { country, countryCode: code || null };
    } catch {
      // try next public API
    }
  }
  return { country: '优选', countryCode: null };
}

async function enrichCountries(rows) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      output[index] = { ...row, ...(await lookupCountry(row.ip)) };
    }
  }
  await Promise.all(Array.from({ length: COUNTRY_CONCURRENCY }, worker));
  return output;
}

const html = await fetchText(CFIP_PAGE);
const rows = parseCfipTable(html);
if (!rows.length) throw new Error('No rows parsed from v2rayssr cfip-table');
const nodes = await enrichCountries(rows);
const generatedAt = new Date().toISOString();
const payload = {
  version: 1,
  generatedAt,
  source: CFIP_PAGE,
  count: nodes.length,
  lines: [...new Set(nodes.map(node => node.line))],
  nodes,
};

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`Wrote ${nodes.length} CFIP nodes to ${OUT_FILE}`);
