# ShyVPN deployment notes

This fork is deployed to Cloudflare Workers as `edgetunnel-vless` for `shyvpn.cc.cd`.

## Subscription endpoints

- Recommended visible subscription URL: `http://shyvpn.cc.cd/`
- HTTPS subscription URL: `https://shyvpn.cc.cd/`
- Token endpoint: `/sub?token=<generated-token>`

Browser access to `/` still returns the camouflage page. Subscription clients are detected by User-Agent and are internally routed to `/sub?token=...`.

## Client compatibility verified

- Sparkle `v1.26` / mihomo `v1.19.20`: imports Clash YAML with VLESS proxies.
- Clash for Android `2.5.12.premium`: receives Clash YAML instead of base64 VLESS text.
- v2rayN `7.x`: receives base64 VLESS subscription text.
- sing-box `1.10.x`: receives sing-box JSON.

## Cloudflare Worker bindings

Required bindings:

- `UUID`: VLESS UUID.
- `ADMIN`: admin password, can reuse the UUID.
- `HOST`: public custom domain, for example `shyvpn.cc.cd`.
- `KV`: namespace binding used by the upstream admin/config UI.

Recommended binding:

- `SUBSCRIBE_ORIGIN`: stable origin used by the external subscription converter callback. For this deployment it points to the Workers.dev hostname, while generated proxy nodes still use `HOST`.

Do not commit Cloudflare API keys, bearer tokens, GitHub tokens, UUID secrets, or generated subscription tokens.

## Validation checklist

- `https://shyvpn.cc.cd/` with `Sparkle/1.26 mihomo/1.19.20` returns `application/x-yaml`.
- YAML contains `proxies:` and VLESS nodes, not placeholder Direct-only nodes.
- `mihomo.exe -t -f <downloaded-yaml>` succeeds.
- Runtime proxy test through mihomo returns HTTP `204` for `http://www.gstatic.com/generate_204`.
- Runtime proxy test through mihomo returns HTTP `200` for `https://example.com/` and `https://www.cloudflare.com/cdn-cgi/trace`.

## CFIP data refresh

This fork keeps its own Cloudflare preferred-IP cache at `data/cfip.json`.

- `.github/workflows/update-cfip.yml` runs every 6 hours and can also be run manually.
- `scripts/update-cfip-data.mjs` scrapes `https://v2rayssr.com/cfip/`, parses `table.cfip-table`, enriches IP country/region through public IP APIs, and commits the ranked result.
- The Worker reads `CFIP_DATA_URL` first, then falls back to this repository raw URL, then to live `v2rayssr` scraping, then to built-in fallback data.
- Clash/Mihomo output keeps the original `优选节点` group and adds carrier groups such as `电信`, `联通`, `移动`, `多线` when CFIP data is available.

GitHub Actions quota note: public repositories generally get free GitHub-hosted runner usage; private repositories on GitHub Free include limited monthly minutes. Keep the schedule at 6 hours unless a faster refresh is actually needed.
