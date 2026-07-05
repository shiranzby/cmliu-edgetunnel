import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFIP_PAGE = 'https://v2rayssr.com/cfip/';
const CF_LOCATIONS_URL = 'https://speed.cloudflare.com/locations';
const OUT_FILE = fileURLToPath(new URL('../data/cfip.json', import.meta.url));
const REQUEST_TIMEOUT_MS = 6000;
const COUNTRY_CONCURRENCY = 6;
const MAX_ROWS = 50;

const countryNameMap = {
  US: '美国',
  CA: '加拿大',
  JP: '日本',
  SG: '新加坡',
  DE: '德国',
  NL: '荷兰',
  HK: '中国香港',
  TW: '中国台湾',
  KR: '韩国',
  GB: '英国',
  FR: '法国',
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

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'ShyVPN-CFIP-Updater/1.1',
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
    const line = htmlDecode(match.groups.line).replace(/^ipv6$/i, 'IPV6');
    rows.push({
      rank: Number(match.groups.rank),
      line,
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

async function loadCloudflareLocations() {
  try {
    const locations = JSON.parse(await fetchText(CF_LOCATIONS_URL, 12000));
    const map = new Map();
    for (const location of Array.isArray(locations) ? locations : []) {
      const code = String(location.iata || location.colo || '').toUpperCase();
      if (!code) continue;
      map.set(code, {
        code,
        city: location.city || '',
        region: location.region || '',
        country: location.country || '',
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function parseTrace(text) {
  const data = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

async function lookupCloudflareTrace(ip, locations) {
  try {
    const trace = parseTrace(await fetchText(`http://${ip}/cdn-cgi/trace`, 5000));
    const colo = String(trace.colo || '').toUpperCase();
    const loc = String(trace.loc || '').toUpperCase();
    const location = locations.get(colo);
    const country = countryNameMap[loc] || location?.country || '';
    const displayRegion = location?.city || location?.region || country || (colo ? `CF-${colo}` : '');
    if (displayRegion || country || colo) {
      return {
        displayRegion,
        country,
        countryCode: loc || null,
        cfColo: colo || null,
        cfCity: location?.city || null,
      };
    }
  } catch {
    // Direct trace can be blocked by local network. Fallback to public geo APIs.
  }
  return null;
}

async function lookupPublicGeo(ip) {
  const apis = [
    `https://ipwho.is/${encodeURIComponent(ip)}`,
    `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,query`,
  ];
  for (const api of apis) {
    try {
      const data = JSON.parse(await fetchText(api, REQUEST_TIMEOUT_MS));
      const code = String(data.country_code || data.countryCode || '').toUpperCase();
      const country = countryNameMap[code] || data.country || '';
      const region = data.regionName || data.region || '';
      const city = data.city || '';
      const displayRegion = city || region || country;
      if (displayRegion || country) {
        return {
          displayRegion,
          country,
          countryCode: code || null,
          region: region || null,
          city: city || null,
        };
      }
    } catch {
      // try next API
    }
  }
  return null;
}

async function enrichNode(row, locations) {
  const traceGeo = await lookupCloudflareTrace(row.ip, locations);
  const publicGeo = traceGeo ? null : await lookupPublicGeo(row.ip);
  const geo = traceGeo || publicGeo || {};
  return {
    ...row,
    ...geo,
    displayRegion: geo.displayRegion || row.line || '优选',
    geoSource: traceGeo ? 'cloudflare-trace' : (publicGeo ? 'public-ip-api' : 'line-fallback'),
  };
}

async function enrichNodes(rows) {
  const locations = await loadCloudflareLocations();
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await enrichNode(rows[index], locations);
    }
  }
  await Promise.all(Array.from({ length: COUNTRY_CONCURRENCY }, worker));
  return output;
}

const html = await fetchText(CFIP_PAGE, 20000);
const rows = parseCfipTable(html);
if (!rows.length) throw new Error('No rows parsed from v2rayssr cfip-table');
const nodes = await enrichNodes(rows);
const payload = {
  version: 2,
  generatedAt: new Date().toISOString(),
  source: CFIP_PAGE,
  count: nodes.length,
  lines: [...new Set(nodes.map(node => node.line))],
  nodes,
};

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`Wrote ${nodes.length} CFIP nodes to ${OUT_FILE}`);
