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
