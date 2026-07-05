// <!--GAMFC-->version base on commit 43fad05dcdae3b723c53c226f8181fc5bd47223e, time is 2023-06-22 15:20:05 UTC<!--GAMFC-END-->.
// @ts-ignore
import { connect } from 'cloudflare:sockets';

// How to generate your own UUID:
// [Windows] Press "Win + R", input cmd and run:  Powershell -NoExit -Command "[guid]::NewGuid()"
let userID = '90cd4a77-141a-43c9-991b-08263cfe9c10';

let proxyIP = '';// 小白勿动，该地址并不影响你的网速，这是给CF代理使用的。'cdn.xn--b6gac.eu.org', 'cdn-all.xn--b6gac.eu.org', 'edgetunnel.anycast.eu.org'

//let sub = '';// 留空则显示原版内容
let sub = 'sub.cmliussss.workers.dev';// 内置优选订阅生成器，可自行搭建 https://github.com/cmliu/WorkerVless2sub
let subconverter = 'api.v1.mk';// clash订阅转换后端，目前使用肥羊的订阅转换功能。支持自建psub 可自行搭建https://github.com/bulianglin/psub
let subconfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini"; //订阅配置文件
// The user name and password do not contain special characters
// Setting the address will ignore proxyIP
// Example:  user:pass@host:port  or  host:port
let socks5Address = '';
let RproxyIP = 'false';

// ========== WorkerVless2sub 融合功能：优选IP来源 ==========
let ADD = '';          // 静态优选IP，格式: "ip:port#别名,domain:port#别名"
let ADDAPI = '';       // 远程优选IP TXT 文件 URL
let ADDCSV = '';       // CSV 测速数据 URL
let DLS = 0;           // 测速速度下限 (Mbps)
let ADDNOTLS = '';     // 非 TLS 静态优选IP
let ADDNOTLSAPI = '';   // 非 TLS 远程优选IP URL
let CMPROXYIPS = '';   // 地区优选 ProxyIP，格式: "proxyip.domain#HK,proxyip.domain#SG"
let SOCKS5DATA = '';   // Socks5 代理池数据 URL
let PROXYIPAPI = '';   // ProxyIP 列表 API URL
let CMADD = '';        // 本地补充 ProxyIP 列表
let CFPORTS = '443,2053,2083,2087,2096,8443'; // CF 标准端口列表
// =====================================================
if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

let parsedSocks5Address = {}; 
let enableSocks = false;

// 虚假uuid和hostname，用于发送给配置生成服务
let fakeUserID = generateUUID();
let fakeHostName = generateRandomString();

export default {
	/**
	 * @param {import("@cloudflare/workers-types").Request} request
	 * @param {{UUID: string, PROXYIP: string}} env
	 * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
	 * @returns {Promise<Response>}
	 */
	async fetch(request, env, ctx) {
		try {
			const userAgent = request.headers.get('User-Agent').toLowerCase();
			userID = env.UUID || userID;
			proxyIP = env.PROXYIP || proxyIP;
			socks5Address = env.SOCKS5 || socks5Address;
			sub = env.SUB || sub;
			subconverter = env.SUBAPI || subconverter;
			subconfig = env.SUBCONFIG || subconfig;
			// WorkerVless2sub 融合: 优选IP来源
			ADD = env.ADD || ADD;
			ADDAPI = env.ADDAPI || ADDAPI;
			ADDCSV = env.ADDCSV || ADDCSV;
			DLS = parseFloat(env.DLS) || DLS;
			ADDNOTLS = env.ADDNOTLS || ADDNOTLS;
			ADDNOTLSAPI = env.ADDNOTLSAPI || ADDNOTLSAPI;
			CMPROXYIPS = env.CMPROXYIPS || CMPROXYIPS;
			SOCKS5DATA = env.SOCKS5DATA || SOCKS5DATA;
			PROXYIPAPI = env.PROXYIPAPI || PROXYIPAPI;
			CMADD = env.CMADD || CMADD;
			CFPORTS = env.CFPORTS || CFPORTS;
			//RproxyIP = env.RPROXYIP || !proxyIP ? 'true' : 'false';
			if (socks5Address) {
				RproxyIP = env.RPROXYIP || 'false';
				try {
					parsedSocks5Address = socks5AddressParser(socks5Address);
					enableSocks = true;
				} catch (err) {
  			/** @type {Error} */ let e = err;
					console.log(e.toString());
					enableSocks = false;
				}
			} else {
				RproxyIP = env.RPROXYIP || !proxyIP ? 'true' : 'false';
			}
			const upgradeHeader = request.headers.get('Upgrade');
			const url = new URL(request.url);
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				// const url = new URL(request.url);
				switch (url.pathname) {
				case '/':
					// Root path: auto-detect client type
					const rootHost = request.headers.get('Host') || url.host;
					if (userAgent && userAgent.includes('mozilla')) {
						// Browser: redirect to HTML page
						return new Response(null, {
							status: 301,
							headers: {
								"Location": `https://${rootHost}/${userID}`,
							}
						});
					} else {
						// Subscription client: redirect to Clash format (most compatible)
						return new Response(null, {
							status: 301,
							headers: {
								"Location": `https://${rootHost}/${userID}?clash=vmess`,
							}
						});
					}
				case `/${userID}`: {
					const host = request.headers.get('Host');
					const now = Date.now();
					const timestamp = Math.floor(now / 1000);
					const today = new Date(now);
					today.setHours(0, 0, 0, 0);
					const format = url.searchParams.get('clash') || url.searchParams.get('singbox') ? 'clash' : (url.searchParams.get('format') || '');
					
					// ===== 允许 URL 参数覆盖配置 (Web 管理页提交) =====
					const urlADD = url.searchParams.get('ADD') || '';
					const urlDLS = parseFloat(url.searchParams.get('DLS')) || 0;
					const effectiveADD = urlADD || ADD; // URL 参数优先于 env var
					const effectiveDLS = urlDLS || DLS;
					
					// JSON API: 返回节点列表 (仅解析 ADD，不请求外部服务以避免阻塞前端)
					if (url.searchParams.has('json')) {
						const defaultPort = parseInt((CFPORTS || '443').split(',')[0]) || 443;
						const prefNodes = parseIPList(effectiveADD, defaultPort).map(n => ({
							name: n.name || n.host + ':' + n.port,
							server: n.host,
							port: n.port
						}));
						return new Response(JSON.stringify({
							preferred: prefNodes,
							fallback: [],
							config: { ADD: effectiveADD || '(未设置)', DLS: effectiveDLS, UUID: userID, HOST: host }
						}), {
							status: 200,
							headers: { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": "*" }
						});
					}
					
					// Clash subscription: detect by query param or User-Agent
					const isClashClient = url.searchParams.has('clash') || (userAgent && (userAgent.includes('clash') || userAgent.includes('verge') || userAgent.includes('clashmeta') || userAgent.includes('nyanpasu') || userAgent.includes('cfw')) && !userAgent.includes('mozilla'));
					if (isClashClient) {
						const clashYaml = await generateClashConfig(userID, host, sub, RproxyIP, effectiveADD, effectiveDLS);
						return new Response(clashYaml, {
							status: 200,
							headers: {
								"Content-Disposition": "attachment; filename=clash.yaml; filename*=utf-8''clash.yaml",
								"Content-Type": "text/yaml;charset=utf-8",
								"Profile-Update-Interval": "6",
								"Subscription-Userinfo": `upload=0; download=${Math.floor(((now - today.getTime())/86400000) * 24 * 1099511627776)}; total=${24 * 1099511627776}; expire=${timestamp}`,
							}
						});
					}
					
					// Sing-box subscription: detect by query param or User-Agent
					const isSingboxClient = url.searchParams.has('singbox') || url.searchParams.has('sing-box') || (userAgent && (userAgent.includes('singbox') || userAgent.includes('sing-box') || userAgent.includes('sfi')) && !userAgent.includes('mozilla'));
					if (isSingboxClient) {
						const singboxJson = generateSingboxConfig(userID, host);
						return new Response(singboxJson, {
							status: 200,
							headers: {
								"Content-Disposition": "attachment; filename=singbox.json; filename*=utf-8''singbox.json",
								"Content-Type": "application/json;charset=utf-8",
								"Profile-Update-Interval": "6",
								"Subscription-Userinfo": `upload=0; download=${Math.floor(((now - today.getTime())/86400000) * 24 * 1099511627776)}; total=${24 * 1099511627776}; expire=${timestamp}`,
							}
						});
					}
					
					const vlessConfig = await getVLESSConfig(userID, host, sub, userAgent, RproxyIP);
					if (userAgent && userAgent.includes('mozilla')){
						// Build subscription URLs
						const baseUrl = `https://${host}/${userID}`;
						const clashUrl = `${baseUrl}?clash=vmess`;
						const singboxUrl = `${baseUrl}?singbox=vmess`;
						const vlessLink = `vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${host}`;
						
						const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Edgetunnel · 订阅管理</title>
<style>
:root {
  --bg: #f4f8fd;
  --card-bg: #ffffff;
  --card-border: #e2e8f0;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --accent: #2563eb;
  --accent-light: #3b82f6;
  --accent-bg: #eff6ff;
  --accent-border: #bfdbfe;
  --success: #16a34a;
  --success-bg: #f0fdf4;
  --warning: #ea580c;
  --shadow: 0 1px 3px 0 rgba(0,0,0,.06), 0 1px 2px -1px rgba(0,0,0,.04);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,.06), 0 2px 4px -2px rgba(0,0,0,.04);
  --radius: 12px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC',sans-serif;
  background:linear-gradient(180deg,#eef4ff 0%,#e4ecf9 30%,#f4f8fd 100%);
  min-height:100vh;color:var(--text-primary);line-height:1.6;
}
.container{max-width:720px;width:100%;margin:0 auto;padding:24px 16px}
.card{
  background:var(--card-bg);border-radius:var(--radius);padding:20px;
  margin-bottom:16px;border:1px solid var(--card-border);box-shadow:var(--shadow);
  transition:box-shadow .2s;
}
.card:hover{box-shadow:var(--shadow-md)}
.header{
  text-align:center;padding:32px 20px 20px;
  background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:var(--radius);
  margin-bottom:20px;color:#fff;box-shadow:0 4px 14px -4px rgba(37,99,235,.3);
}
.header .icon{font-size:32px;margin-bottom:8px}
.header h1{font-size:22px;font-weight:700;letter-spacing:-.5px}
.header p{font-size:13px;opacity:.85;margin-top:4px}
.status-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(min-width:500px){.status-grid{grid-template-columns:repeat(4,1fr)}}
.status-item{background:var(--accent-bg);border-radius:8px;padding:12px;border:1px solid var(--accent-border)}
.status-item .label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.status-item .value{font-size:13px;font-weight:600;color:var(--accent);font-family:'SF Mono','Fira Code','Consolas',monospace;word-break:break-all}
.section-title{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-title::before{content:'';width:3px;height:16px;background:var(--accent);border-radius:2px;flex-shrink:0}
.sub-url-box{background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:8px;padding:14px;margin-bottom:12px}
.sub-url-box .url{font-family:'SF Mono','Fira Code','Consolas',monospace;font-size:12px;color:var(--accent);word-break:break-all;line-height:1.6}
.sub-url-box .hint{font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;align-items:center;gap:4px}
.format-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.format-tag{font-size:10px;padding:3px 10px;border-radius:12px;background:#fff;border:1px solid var(--accent-border);color:var(--text-secondary)}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:10px 20px;border:none;border-radius:8px;font-size:13px;font-weight:500;
  cursor:pointer;transition:all .2s;text-decoration:none;
}
.btn-primary{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;box-shadow:0 2px 8px -2px rgba(37,99,235,.3)}
.btn-primary:hover{background:linear-gradient(135deg,#1d4ed8,#1e40af);box-shadow:0 4px 12px -2px rgba(37,99,235,.4);transform:translateY(-1px)}
.btn-outline{background:#fff;color:var(--accent);border:1px solid var(--accent-border)}
.btn-outline:hover{background:var(--accent-bg);border-color:var(--accent)}
.btn-sm{padding:6px 14px;font-size:12px}
.btn-block{width:100%;justify-content:center}
.btn-row{display:flex;gap:8px;flex-wrap:wrap}
.btn.copied{background:var(--success)!important;border-color:var(--success)!important;color:#fff!important}
.form-group{margin-bottom:12px}.form-group:last-child{margin-bottom:0}
.form-label{display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:4px}
.form-input{
  width:100%;padding:10px 12px;border:1px solid var(--card-border);border-radius:8px;
  background:#fff;color:var(--text-primary);font-size:13px;
  font-family:'SF Mono','Fira Code','Consolas',monospace;outline:none;
  transition:border-color .2s,box-shadow .2s;
}
.form-input:focus{border-color:var(--accent-light);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.form-input::placeholder{color:var(--text-muted)}
.form-hint{font-size:11px;color:var(--text-muted);margin-top:4px}
.node-section{margin-bottom:10px}
.node-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 14px;background:var(--accent-bg);border:1px solid var(--accent-border);
  border-radius:8px;cursor:pointer;user-select:none;transition:background .2s;
}
.node-header:hover{background:#dbeafe}
.node-header h3{font-size:13px;font-weight:600;color:var(--text-primary)}
.badge{font-size:10px;padding:2px 10px;border-radius:10px;font-weight:600}
.badge-pref{background:#dcfce7;color:var(--success)}
.badge-fallback{background:var(--accent-bg);color:var(--accent)}
.nodelist{
  max-height:240px;overflow-y:auto;border:1px solid var(--card-border);
  border-top:none;border-radius:0 0 8px 8px;background:#f8fafc;
}
.nodelist.collapsed{display:none}
.node-item{
  display:flex;justify-content:space-between;padding:6px 14px;font-size:11px;
  font-family:'SF Mono','Fira Code','Consolas',monospace;color:var(--text-secondary);
  border-bottom:1px solid #f1f5f9;
}
.node-item:last-child{border-bottom:none}
.node-item .server{color:var(--accent);font-weight:500}
.loading{text-align:center;padding:30px;color:var(--text-muted);font-size:13px}
.loading .spinner{
  width:20px;height:20px;border:2px solid var(--accent-border);
  border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite;
  margin:0 auto 8px;
}
@keyframes spin{to{transform:rotate(360deg)}}
.empty-state{text-align:center;padding:20px;color:var(--text-muted);font-size:12px}
.empty-state .icon{font-size:28px;margin-bottom:6px;opacity:.6}
.footer{text-align:center;padding:20px;font-size:11px;color:var(--text-muted)}
.footer a{color:var(--accent);text-decoration:none}
.footer a:hover{text-decoration:underline}
@media(max-width:480px){.container{padding:12px 8px}.card{padding:14px}.header{padding:24px 16px 16px}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="icon">🔗</div>
    <h1>Edgetunnel</h1>
    <p>VLESS over WebSocket · Cloudflare Workers</p>
  </div>

  <div class="card">
    <div class="section-title">服务状态</div>
    <div class="status-grid">
      <div class="status-item"><div class="label">UUID</div><div class="value">${userID.slice(0,13)}...</div></div>
      <div class="status-item"><div class="label">服务器</div><div class="value">${host}</div></div>
      <div class="status-item"><div class="label">端口 / 传输</div><div class="value">443 · WS+TLS</div></div>
      <div class="status-item"><div class="label">订阅服务</div><div class="value">${sub || '内置'}</div></div>
    </div>
  </div>

  <div class="card">
    <div class="section-title">订阅链接</div>
    <div class="sub-url-box">
      <div class="url" id="subUrl">${baseUrl}</div>
      <div class="hint">💡 自动识别客户端：Clash Meta / Sing-box / v2rayN / Shadowrocket 等</div>
      <div class="format-tags">
        <span class="format-tag">Clash Meta</span>
        <span class="format-tag">Sing-box</span>
        <span class="format-tag">v2rayN</span>
        <span class="format-tag">Nekoray</span>
        <span class="format-tag">Shadowrocket</span>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="copySubBtn">📋 复制订阅链接</button>
      <button class="btn btn-outline" id="qrBtn">📱 二维码</button>
    </div>
  </div>

  <div class="card">
    <div class="section-title">优选 IP 配置</div>
    <div class="form-group">
      <label class="form-label">手动添加优选 IP (ADD)</label>
      <input class="form-input" id="addInput" placeholder="例: 1.2.3.4:443#HK优选, 5.6.7.8:2053#SG">
      <div class="form-hint">格式: IP:端口#名称，多个用逗号分隔。留空则使用 SUB 服务提供的节点。</div>
    </div>
    <div class="form-group">
      <label class="form-label">测速下限 (DLS, Mbps)</label>
      <input class="form-input" id="dlsInput" type="number" placeholder="0 表示不过滤" value="0">
      <div class="form-hint">仅对 CSV 测速数据源生效，低于此速度的节点将被过滤。</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="applyBtn">🔄 刷新节点列表</button>
      <button class="btn btn-outline" id="copyClashBtn">📋 复制 Clash 链接</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted);word-break:break-all" id="genUrl"></div>
  </div>

  <div class="card">
    <div class="section-title">节点列表</div>
    <div id="nodesSection">
      <div class="loading">
        <div class="spinner"></div>
        正在加载节点列表...
      </div>
    </div>
  </div>

  <div class="footer">
    Powered by <a href="https://github.com/cmliu/edgetunnel" target="_blank">edgetunnel</a>
  </div>
</div>

<script>
(function(){
  var UUID='${userID}';
  var HOST='${host}';
  var BASE='${baseUrl}';

  function copyText(text,btn,orig){
    var origT=orig||btn.textContent;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='✅ 已复制';btn.classList.add('copied');
        setTimeout(function(){btn.textContent=origT;btn.classList.remove('copied')},2000);
      }).catch(function(){fallbackCopy(text,btn,origT)});
    }else{fallbackCopy(text,btn,origT)}
  }

  function fallbackCopy(text,btn,orig){
    var ta=document.createElement('textarea');ta.value=text;
    ta.style.cssText='position:fixed;left:-9999px';document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');btn.textContent='✅ 已复制';btn.classList.add('copied');
      setTimeout(function(){btn.textContent=orig;btn.classList.remove('copied')},2000);
    }catch(e){alert('复制失败，请手动复制')}
    document.body.removeChild(ta)
  }

  document.getElementById('copySubBtn').onclick=function(){
    copyText(BASE,this,'📋 复制订阅链接')
  };

  document.getElementById('qrBtn').onclick=function(){
    var exist=document.getElementById('qrModal');
    if(exist){exist.remove();return}
    var modal=document.createElement('div');
    modal.id='qrModal';
    modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1000';
    modal.onclick=function(e){if(e.target===modal)modal.remove()};
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;padding:28px;text-align:center;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.12)';
    box.innerHTML='<h3 style="margin-bottom:16px;font-size:16px;color:#1e293b;font-weight:600">📱 扫描二维码订阅</h3>'+
      '<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data='+encodeURIComponent(BASE)+'" style="width:220px;height:220px;border-radius:10px;background:#f8fafc" onerror="var fb=document.getElementById(\'qrFallback\');if(fb)fb.style.display=\'block\';this.style.display=\'none\'">'+
      '<div id="qrFallback" style="display:none;padding:20px;color:#94a3b8;font-size:13px">二维码加载失败<br>请直接复制订阅链接</div>'+
      '<p style="margin-top:12px;font-size:11px;color:#94a3b8;word-break:break-all">'+BASE+'</p>';
    modal.appendChild(box);
    document.body.appendChild(modal)
  };

  function updateUrl(){
    var add=encodeURIComponent(document.getElementById('addInput').value);
    var dls=document.getElementById('dlsInput').value;
    var params='?clash=vmess';
    if(add)params+='&ADD='+add;
    if(dls&&parseFloat(dls)>0)params+='&DLS='+dls;
    var url='https://'+HOST+'/'+UUID+params;
    document.getElementById('genUrl').textContent=url;
    document.getElementById('genUrl').dataset.url=url
  }

  async function loadNodes(){
    var el=document.getElementById('nodesSection');
    try{
      var r=await fetch('?json',{headers:{'User-Agent':'Mozilla/5.0'}});
      var data=await r.json();
      var pref=data.preferred||[];
      var cfg=data.config||{};
      if(cfg.ADD&&cfg.ADD!=='(未设置)')document.getElementById('addInput').value=cfg.ADD;
      if(cfg.DLS>0)document.getElementById('dlsInput').value=cfg.DLS;
      var html='';
      html+='<div class="node-section"><div class="node-header" onclick="var nl=this.nextElementSibling;nl.classList.toggle(\'collapsed\')"><h3>⭐ 优选节点</h3><span class="badge badge-pref">'+pref.length+' 个</span></div><div class="nodelist'+(pref.length>8?' collapsed':'')+'">';
      if(pref.length){
        for(var i=0;i<pref.length;i++){
          html+='<div class="node-item"><span>'+pref[i].name+'</span><span class="server">'+pref[i].server+':'+pref[i].port+'</span></div>'
        }
      }else{
        html+='<div class="empty-state"><div class="icon">📭</div>暂未配置优选 IP<br><span style="font-size:10px">在上方输入 IP 地址后点击刷新即可显示</span></div>'
      }
      html+='</div></div>';
      el.innerHTML=html;
      updateUrl()
    }catch(e){
      el.innerHTML='<div class="loading" style="color:#ef4444">❌ 加载失败: 请检查网络连接</div>'
    }
  }

  document.getElementById('applyBtn').onclick=function(){
    var btn=this,orig=btn.textContent;
    btn.textContent='⏳ 加载中...';btn.disabled=true;
    updateUrl();
    loadNodes().then(function(){btn.textContent=orig;btn.disabled=false})
  };

  document.getElementById('copyClashBtn').onclick=function(){
    updateUrl();
    var url=document.getElementById('genUrl').dataset.url||document.getElementById('genUrl').textContent;
    copyText(url,this,'📋 复制 Clash 链接')
  };

  document.getElementById('addInput').oninput=updateUrl;
  document.getElementById('dlsInput').oninput=updateUrl;
  loadNodes()
})();
</script>
</body>
</html>`;
						return new Response(html, {
							status: 200,
							headers: {
								"Content-Type": "text/html;charset=utf-8",
							}
						});
					} else {
						return new Response(`${vlessConfig}`, {
							status: 200,
							headers: {
								"Content-Disposition": "attachment; filename=edgetunnel; filename*=utf-8''edgetunnel",
								"Content-Type": "text/plain;charset=utf-8",
								"Profile-Update-Interval": "6",
								"Subscription-Userinfo": `upload=0; download=${Math.floor(((now - today.getTime())/86400000) * 24 * 1099511627776)}; total=${24 * 1099511627776}; expire=${timestamp}`,
							}
						});
					}
				}
				default:
					return new Response('Not found', { status: 404 });
				}
			} else {
				if (new RegExp('/proxyip=', 'i').test(url.pathname)) proxyIP = url.pathname.split("=")[1];
				else if (new RegExp('/proxyip.', 'i').test(url.pathname)) proxyIP = url.pathname.split("/proxyip.")[1];
				else if (!proxyIP || proxyIP == '') proxyIP = 'proxyip.fxxk.dedyn.io';
				return await vlessOverWSHandler(request);
			}
		} catch (err) {
			/** @type {Error} */ let e = err;
			return new Response(e.toString());
		}
	},
};




/**
 * 
 * @param {import("@cloudflare/workers-types").Request} request
 */
async function vlessOverWSHandler(request) {

	/** @type {import("@cloudflare/workers-types").WebSocket[]} */
	// @ts-ignore
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);

	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';
	const log = (/** @type {string} */ info, /** @type {string | undefined} */ event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

	/** @type {{ value: import("@cloudflare/workers-types").Socket | null}}*/
	let remoteSocketWapper = {
		value: null,
	};
	let isDns = false;

	// ws --> remote
	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns) {
				return await handleDNSQuery(chunk, webSocket, null, log);
			}
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter()
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			const {
				hasError,
				message,
				addressType,
				portRemote = 443,
				addressRemote = '',
				rawDataIndex,
				vlessVersion = new Uint8Array([0, 0]),
				isUDP,
			} = processVlessHeader(chunk, userID);
			address = addressRemote;
			portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '
				} `;
			if (hasError) {
				// controller.error(message);
				throw new Error(message); // cf seems has bug, controller.error will not end stream
				// webSocket.close(1000, message);
				return;
			}
			// if UDP but port not DNS port, close it
			if (isUDP) {
				if (portRemote === 53) {
					isDns = true;
				} else {
					// controller.error('UDP proxy only enable for DNS which is port 53');
					throw new Error('UDP proxy only enable for DNS which is port 53'); // cf seems has bug, controller.error will not end stream
					return;
				}
			}
			// ["version", "附加信息长度 N"]
			const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);

			if (isDns) {
				return handleDNSQuery(rawClientData, webSocket, vlessResponseHeader, log);
			}
			handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log);
		},
		close() {
			log(`readableWebSocketStream is close`);
		},
		abort(reason) {
			log(`readableWebSocketStream is abort`, JSON.stringify(reason));
		},
	})).catch((err) => {
		log('readableWebSocketStream pipeTo error', err);
	});

	return new Response(null, {
		status: 101,
		// @ts-ignore
		webSocket: client,
	});
}

/**
 * Handles outbound TCP connections.
 *
 * @param {any} remoteSocket
 * @param {number} addressType The remote address type to connect to.
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} vlessResponseHeader The VLESS response header.
 * @param {function} log The logging function.
 * @returns {Promise<void>} The remote socket.
 */
async function handleTCPOutBound(remoteSocket, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log,) {
	async function connectAndWrite(address, port, socks = false) {
		/** @type {import("@cloudflare/workers-types").Socket} */
		const tcpSocket = socks ? await socks5Connect(addressType, address, port, log)
			: connect({
				hostname: address,
				port: port,
			});
		remoteSocket.value = tcpSocket;
		log(`connected to ${address}:${port}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(rawClientData); // first write, normal is tls client hello
		writer.releaseLock();
		return tcpSocket;
	}

	// if the cf connect tcp socket have no incoming data, we retry to redirect ip
	async function retry() {
		if (enableSocks) {
			tcpSocket = await connectAndWrite(addressRemote, portRemote, true);
		} else {
			tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote);
		}
		// no matter retry success or not, close websocket
		tcpSocket.closed.catch(error => {
			console.log('retry tcpSocket closed error', error);
		}).finally(() => {
			safeCloseWebSocket(webSocket);
		})
		remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log);
	}

	let tcpSocket = await connectAndWrite(addressRemote, portRemote);

	// when remoteSocket is ready, pass to websocket
	// remote--> ws
	remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}

/**
 * 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer
 * @param {string} earlyDataHeader for ws 0rtt
 * @param {(info: string)=> void} log for ws 0rtt
 */
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
	let readableStreamCancel = false;
	const stream = new ReadableStream({
		start(controller) {
			webSocketServer.addEventListener('message', (event) => {
				if (readableStreamCancel) {
					return;
				}
				const message = event.data;
				controller.enqueue(message);
			});

			// The event means that the client closed the client -> server stream.
			// However, the server -> client stream is still open until you call close() on the server side.
			// The WebSocket protocol says that a separate close message must be sent in each direction to fully close the socket.
			webSocketServer.addEventListener('close', () => {
				// client send close, need close server
				// if stream is cancel, skip controller.close
				safeCloseWebSocket(webSocketServer);
				if (readableStreamCancel) {
					return;
				}
				controller.close();
			}
			);
			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error');
				controller.error(err);
			}
			);
			// for ws 0rtt
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) {
				controller.error(error);
			} else if (earlyData) {
				controller.enqueue(earlyData);
			}
		},

		pull(controller) {
			// if ws can stop read if stream is full, we can implement backpressure
			// https://streams.spec.whatwg.org/#example-rs-push-backpressure
		},
		cancel(reason) {
			// 1. pipe WritableStream has error, this cancel will called, so ws handle server close into here
			// 2. if readableStream is cancel, all controller.close/enqueue need skip,
			// 3. but from testing controller.error still work even if readableStream is cancel
			if (readableStreamCancel) {
				return;
			}
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});

	return stream;

}

// https://xtls.github.io/development/protocols/vless.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

/**
 * 
 * @param { ArrayBuffer} vlessBuffer 
 * @param {string} userID 
 * @returns 
 */
function processVlessHeader(
	vlessBuffer,
	userID
) {
	if (vlessBuffer.byteLength < 24) {
		return {
			hasError: true,
			message: 'invalid data',
		};
	}
	const version = new Uint8Array(vlessBuffer.slice(0, 1));
	let isValidUser = false;
	let isUDP = false;
	if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
		isValidUser = true;
	}
	if (!isValidUser) {
		return {
			hasError: true,
			message: 'invalid user',
		};
	}

	const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
	//skip opt for now

	const command = new Uint8Array(
		vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
	)[0];

	// 0x01 TCP
	// 0x02 UDP
	// 0x03 MUX
	if (command === 1) {
	} else if (command === 2) {
		isUDP = true;
	} else {
		return {
			hasError: true,
			message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`,
		};
	}
	const portIndex = 18 + optLength + 1;
	const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
	// port is big-Endian in raw data etc 80 == 0x005d
	const portRemote = new DataView(portBuffer).getUint16(0);

	let addressIndex = portIndex + 2;
	const addressBuffer = new Uint8Array(
		vlessBuffer.slice(addressIndex, addressIndex + 1)
	);

	// 1--> ipv4  addressLength =4
	// 2--> domain name addressLength=addressBuffer[1]
	// 3--> ipv6  addressLength =16
	const addressType = addressBuffer[0];
	let addressLength = 0;
	let addressValueIndex = addressIndex + 1;
	let addressValue = '';
	switch (addressType) {
		case 1:
			addressLength = 4;
			addressValue = new Uint8Array(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			).join('.');
			break;
		case 2:
			addressLength = new Uint8Array(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)
			)[0];
			addressValueIndex += 1;
			addressValue = new TextDecoder().decode(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			break;
		case 3:
			addressLength = 16;
			const dataView = new DataView(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			// 2001:0db8:85a3:0000:0000:8a2e:0370:7334
			const ipv6 = [];
			for (let i = 0; i < 8; i++) {
				ipv6.push(dataView.getUint16(i * 2).toString(16));
			}
			addressValue = ipv6.join(':');
			// seems no need add [] for ipv6
			break;
		default:
			return {
				hasError: true,
				message: `invild  addressType is ${addressType}`,
			};
	}
	if (!addressValue) {
		return {
			hasError: true,
			message: `addressValue is empty, addressType is ${addressType}`,
		};
	}

	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		vlessVersion: version,
		isUDP,
	};
}


/**
 * 
 * @param {import("@cloudflare/workers-types").Socket} remoteSocket 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket 
 * @param {ArrayBuffer} vlessResponseHeader 
 * @param {(() => Promise<void>) | null} retry
 * @param {*} log 
 */
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
	// remote--> ws
	let remoteChunkCount = 0;
	let chunks = [];
	/** @type {ArrayBuffer | null} */
	let vlessHeader = vlessResponseHeader;
	let hasIncomingData = false; // check if remoteSocket has incoming data
	await remoteSocket.readable
		.pipeTo(
			new WritableStream({
				start() {
				},
				/**
				 * 
				 * @param {Uint8Array} chunk 
				 * @param {*} controller 
				 */
				async write(chunk, controller) {
					hasIncomingData = true;
					// remoteChunkCount++;
					if (webSocket.readyState !== WS_READY_STATE_OPEN) {
						controller.error(
							'webSocket.readyState is not open, maybe close'
						);
					}
					if (vlessHeader) {
						webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
						vlessHeader = null;
					} else {
						// seems no need rate limit this, CF seems fix this??..
						// if (remoteChunkCount > 20000) {
						// 	// cf one package is 4096 byte(4kb),  4096 * 20000 = 80M
						// 	await delay(1);
						// }
						webSocket.send(chunk);
					}
				},
				close() {
					log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
					// safeCloseWebSocket(webSocket); // no need server close websocket frist for some case will casue HTTP ERR_CONTENT_LENGTH_MISMATCH issue, client will send close event anyway.
				},
				abort(reason) {
					console.error(`remoteConnection!.readable abort`, reason);
				},
			})
		)
		.catch((error) => {
			console.error(
				`remoteSocketToWS has exception `,
				error.stack || error
			);
			safeCloseWebSocket(webSocket);
		});

	// seems is cf connect socket have error,
	// 1. Socket.closed will have error
	// 2. Socket.readable will be close without any data coming
	if (hasIncomingData === false && retry) {
		log(`retry`)
		retry();
	}
}

/**
 * 
 * @param {string} base64Str 
 * @returns 
 */
function base64ToArrayBuffer(base64Str) {
	if (!base64Str) {
		return { error: null };
	}
	try {
		// go use modified Base64 for URL rfc4648 which js atob not support
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
		return { earlyData: arryBuffer.buffer, error: null };
	} catch (error) {
		return { error };
	}
}

/**
 * This is not real UUID validation
 * @param {string} uuid 
 */
function isValidUUID(uuid) {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
/**
 * Normally, WebSocket will not has exceptions when close.
 * @param {import("@cloudflare/workers-types").WebSocket} socket
 */
function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
			socket.close();
		}
	} catch (error) {
		console.error('safeCloseWebSocket error', error);
	}
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) {
	byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
	return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
	const uuid = unsafeStringify(arr, offset);
	if (!isValidUUID(uuid)) {
		throw TypeError("Stringified UUID is invalid");
	}
	return uuid;
}

/**
 * 
 * @param {ArrayBuffer} udpChunk 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket 
 * @param {ArrayBuffer} vlessResponseHeader 
 * @param {(string)=> void} log 
 */
async function handleDNSQuery(udpChunk, webSocket, vlessResponseHeader, log) {
	// no matter which DNS server client send, we alwasy use hard code one.
	// beacsue someof DNS server is not support DNS over TCP
	try {
		const dnsServer = '8.8.4.4'; // change to 1.1.1.1 after cf fix connect own ip bug
		const dnsPort = 53;
		/** @type {ArrayBuffer | null} */
		let vlessHeader = vlessResponseHeader;
		/** @type {import("@cloudflare/workers-types").Socket} */
		const tcpSocket = connect({
			hostname: dnsServer,
			port: dnsPort,
		});

		log(`connected to ${dnsServer}:${dnsPort}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(udpChunk);
		writer.releaseLock();
		await tcpSocket.readable.pipeTo(new WritableStream({
			async write(chunk) {
				if (webSocket.readyState === WS_READY_STATE_OPEN) {
					if (vlessHeader) {
						webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
						vlessHeader = null;
					} else {
						webSocket.send(chunk);
					}
				}
			},
			close() {
				log(`dns server(${dnsServer}) tcp is close`);
			},
			abort(reason) {
				console.error(`dns server(${dnsServer}) tcp is abort`, reason);
			},
		}));
	} catch (error) {
		console.error(
			`handleDNSQuery have exception, error: ${error.message}`
		);
	}
}

/**
 * 
 * @param {number} addressType
 * @param {string} addressRemote
 * @param {number} portRemote
 * @param {function} log The logging function.
 */
async function socks5Connect(addressType, addressRemote, portRemote, log) {
	const { username, password, hostname, port } = parsedSocks5Address;
	// Connect to the SOCKS server
	const socket = connect({
		hostname,
		port,
	});

	// Request head format (Worker -> Socks Server):
	// +----+----------+----------+
	// |VER | NMETHODS | METHODS  |
	// +----+----------+----------+
	// | 1  |    1     | 1 to 255 |
	// +----+----------+----------+

	// https://en.wikipedia.org/wiki/SOCKS#SOCKS5
	// For METHODS:
	// 0x00 NO AUTHENTICATION REQUIRED
	// 0x02 USERNAME/PASSWORD https://datatracker.ietf.org/doc/html/rfc1929
	const socksGreeting = new Uint8Array([5, 2, 0, 2]);

	const writer = socket.writable.getWriter();

	await writer.write(socksGreeting);
	log('sent socks greeting');

	const reader = socket.readable.getReader();
	const encoder = new TextEncoder();
	let res = (await reader.read()).value;
	// Response format (Socks Server -> Worker):
	// +----+--------+
	// |VER | METHOD |
	// +----+--------+
	// | 1  |   1    |
	// +----+--------+
	if (res[0] !== 0x05) {
		log(`socks server version error: ${res[0]} expected: 5`);
		return;
	}
	if (res[1] === 0xff) {
		log("no acceptable methods");
		return;
	}

	// if return 0x0502
	if (res[1] === 0x02) {
		log("socks server needs auth");
		if (!username || !password) {
			log("please provide username/password");
			return;
		}
		// +----+------+----------+------+----------+
		// |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
		// +----+------+----------+------+----------+
		// | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
		// +----+------+----------+------+----------+
		const authRequest = new Uint8Array([
			1,
			username.length,
			...encoder.encode(username),
			password.length,
			...encoder.encode(password)
		]);
		await writer.write(authRequest);
		res = (await reader.read()).value;
		// expected 0x0100
		if (res[0] !== 0x01 || res[1] !== 0x00) {
			log("fail to auth socks server");
			return;
		}
	}

	// Request data format (Worker -> Socks Server):
	// +----+-----+-------+------+----------+----------+
	// |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
	// +----+-----+-------+------+----------+----------+
	// | 1  |  1  | X'00' |  1   | Variable |    2     |
	// +----+-----+-------+------+----------+----------+
	// ATYP: address type of following address
	// 0x01: IPv4 address
	// 0x03: Domain name
	// 0x04: IPv6 address
	// DST.ADDR: desired destination address
	// DST.PORT: desired destination port in network octet order

	// addressType
	// 1--> ipv4  addressLength =4
	// 2--> domain name
	// 3--> ipv6  addressLength =16
	let DSTADDR;	// DSTADDR = ATYP + DST.ADDR
	switch (addressType) {
		case 1:
			DSTADDR = new Uint8Array(
				[1, ...addressRemote.split('.').map(Number)]
			);
			break;
		case 2:
			DSTADDR = new Uint8Array(
				[3, addressRemote.length, ...encoder.encode(addressRemote)]
			);
			break;
		case 3:
			DSTADDR = new Uint8Array(
				[4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]
			);
			break;
		default:
			log(`invild  addressType is ${addressType}`);
			return;
	}
	const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
	await writer.write(socksRequest);
	log('sent socks request');

	res = (await reader.read()).value;
	// Response format (Socks Server -> Worker):
	//  +----+-----+-------+------+----------+----------+
	// |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
	// +----+-----+-------+------+----------+----------+
	// | 1  |  1  | X'00' |  1   | Variable |    2     |
	// +----+-----+-------+------+----------+----------+
	if (res[1] === 0x00) {
		log("socks connection opened");
	} else {
		log("fail to open socks connection");
		return;
	}
	writer.releaseLock();
	reader.releaseLock();
	return socket;
}


/**
 * 
 * @param {string} address
 */
function socks5AddressParser(address) {
	let [latter, former] = address.split("@").reverse();
	let username, password, hostname, port;
	if (former) {
		const formers = former.split(":");
		if (formers.length !== 2) {
			throw new Error('Invalid SOCKS address format');
		}
		[username, password] = formers;
	}
	const latters = latter.split(":");
	port = Number(latters.pop());
	if (isNaN(port)) {
		throw new Error('Invalid SOCKS address format');
	}
	hostname = latters.join(":");
	const regex = /^\[.*\]$/;
	if (hostname.includes(":") && !regex.test(hostname)) {
		throw new Error('Invalid SOCKS address format');
	}
	return {
		username,
		password,
		hostname,
		port,
	}
}

function revertFakeInfo(content, userID, hostName, isBase64) {
	if (isBase64) content = atob(content);//Base64解码
	content = content.replace(new RegExp(fakeUserID, 'g'), userID).replace(new RegExp(fakeHostName, 'g'), hostName);
	if (isBase64) content = btoa(content);//Base64编码

	return content;
}

function generateRandomNumber() {
	let minNum = 100000;
	let maxNum = 999999;
	return Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum;
}

function generateRandomString() {
	let minLength = 2;
	let maxLength = 3;
	let length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
	let characters = 'abcdefghijklmnopqrstuvwxyz';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += characters[Math.floor(Math.random() * characters.length)];
	}
	return result;
}

function generateUUID() {
	let uuid = '';
	for (let i = 0; i < 32; i++) {
		let num = Math.floor(Math.random() * 16);
		if (num < 10) {
			uuid += num;
		} else {
			uuid += String.fromCharCode(num + 55);
		}
	}
	return uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5').toLowerCase();
}

// ========== WorkerVless2sub 融合功能函数 ==========

/**
 * Parse preferred IP list from text (ADD format)
 * @param {string} text - "ip:port#alias,domain:port#alias"
 * @param {number} defaultPort
 * @returns {Array<{host:string, port:number, name:string}>}
 */
function parseIPList(text, defaultPort = 443) {
	const nodes = [];
	if (!text) return nodes;
	const items = text.split(',').map(s => s.trim()).filter(Boolean);
	for (const item of items) {
		let host = item;
		let port = defaultPort;
		let name = '';
		const hashIdx = item.lastIndexOf('#');
		if (hashIdx > 0) {
			name = item.slice(hashIdx + 1).trim();
			host = item.slice(0, hashIdx).trim();
		}
		const colonIdx = host.lastIndexOf(':');
		if (colonIdx > 0) {
			const parsedPort = parseInt(host.slice(colonIdx + 1));
			if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
				port = parsedPort;
				host = host.slice(0, colonIdx);
			}
		}
		if (host) nodes.push({ host, port, name: name || `${host}:${port}` });
	}
	return nodes;
}

/**
 * Parse CSV speed test data and return nodes above speed threshold
 * @param {string} csvText 
 * @param {number} minSpeed - Minimum speed in Mbps
 * @param {number} defaultPort
 * @returns {Array<{host:string, port:number, name:string}>}
 */
function parseCSV(csvText, minSpeed = 0, defaultPort = 443) {
	const nodes = [];
	const lines = csvText.split('\n').map(s => s.trim()).filter(Boolean);
	let isHeader = true;
	for (const line of lines) {
		if (isHeader) { isHeader = false; continue; }
		const parts = line.split(',');
		if (parts.length < 2) continue;
		const ip = parts[0].trim();
		const speed = parseFloat(parts[1]);
		if (!ip || (minSpeed > 0 && (isNaN(speed) || speed < minSpeed))) continue;
		let port = defaultPort;
		if (parts.length >= 3) {
			const p = parseInt(parts[2]);
			if (!isNaN(p) && p > 0) port = p;
		}
		nodes.push({ host: ip, port, name: `${ip}:${port}` });
	}
	return nodes;
}

/**
 * Fetch preferred nodes from all sources (ADD, ADDAPI, ADDCSV)
 * @param {string} userID
 * @param {string} hostName 
 * @returns {Promise<Array<{name:string, server:string, port:number, uuid:string, sni:string, path:string, fp:string}>>}
 */
async function fetchPreferredNodes(userID, hostName, urlADD, urlDLS) {
	const nodes = [];
	const defaultPorts = CFPORTS.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
	const defaultPort = defaultPorts[0] || 443;
	const effectiveADD = urlADD || ADD;
	const effectiveDLS = urlDLS || DLS;
	
	// 1. Static ADD (静态优选IP)
	if (effectiveADD) {
		const staticNodes = parseIPList(effectiveADD, defaultPort);
		for (const n of staticNodes) {
			nodes.push({
				name: n.name || `优选-${n.host}:${n.port}`,
				server: n.host,
				port: n.port,
				uuid: userID,
				sni: hostName,
				path: '/?ed=2048',
				fp: 'chrome'
			});
		}
	}
	
	// 2. Remote ADDAPI (远程优选IP TXT)
	if (ADDAPI && typeof fetch === 'function') {
		try {
			const resp = await fetch(ADDAPI, { headers: { 'User-Agent': 'CF-Workers-edgetunnel/cmliu' } });
			const text = await resp.text();
			const remoteNodes = parseIPList(text, defaultPort);
			for (const n of remoteNodes) {
				nodes.push({
					name: n.name || `优选-${n.host}:${n.port}`,
					server: n.host,
					port: n.port,
					uuid: userID,
					sni: hostName,
					path: '/?ed=2048',
					fp: 'chrome'
				});
			}
		} catch (e) { console.error('ADDAPI fetch error:', e); }
	}
	
	// 3. CSV speed test (CSV测速数据)
	if (ADDCSV && typeof fetch === 'function') {
		try {
			const resp = await fetch(ADDCSV, { headers: { 'User-Agent': 'CF-Workers-edgetunnel/cmliu' } });
			const text = await resp.text();
			const csvNodes = parseCSV(text, effectiveDLS, defaultPort);
			for (const n of csvNodes) {
				nodes.push({
					name: `测速-${n.host}:${n.port}`,
					server: n.host,
					port: n.port,
					uuid: userID,
					sni: hostName,
					path: '/?ed=2048',
					fp: 'chrome'
				});
			}
		} catch (e) { console.error('ADDCSV fetch error:', e); }
	}
	
	// 4. Add non-TLS nodes from ADDNOTLS / ADDNOTLSAPI
	if (ADDNOTLS) {
		const notlsNodes = parseIPList(ADDNOTLS, 80);
		for (const n of notlsNodes) {
			nodes.push({
				name: `NOTLS-${n.name || `${n.host}:${n.port}`}`,
				server: n.host,
				port: n.port,
				uuid: userID,
				sni: hostName,
				path: '/?ed=2048',
				fp: 'chrome'
			});
		}
	}
	if (ADDNOTLSAPI && typeof fetch === 'function') {
		try {
			const resp = await fetch(ADDNOTLSAPI, { headers: { 'User-Agent': 'CF-Workers-edgetunnel/cmliu' } });
			const text = await resp.text();
			const notlsNodes = parseIPList(text, 80);
			for (const n of notlsNodes) {
				nodes.push({
					name: `NOTLS-${n.name || `${n.host}:${n.port}`}`,
					server: n.host,
					port: n.port,
					uuid: userID,
					sni: hostName,
					path: '/?ed=2048',
					fp: 'chrome'
				});
			}
		} catch (e) { console.error('ADDNOTLSAPI error:', e); }
	}
	
	return nodes;
}

/**
 * Fetch fallback nodes from the SUB service (existing behavior)
 * @param {string} userID
 * @param {string} hostName
 * @param {string} sub
 * @param {string} RproxyIP
 * @returns {Promise<Array<{name:string, server:string, port:number, uuid:string, sni:string, path:string, fp:string}>>}
 */
async function fetchFallbackNodes(userID, hostName, sub, RproxyIP) {
	const proxies = [];
	if (typeof fetch !== 'function' || !sub) return proxies;
	
	let fHostName = `${fakeHostName}.${generateRandomString()}${generateRandomNumber()}.workers.dev`;
	if (!hostName.includes(".workers.dev") && !hostName.includes(".pages.dev")){
		fHostName = `${fakeHostName}.${generateRandomNumber()}.xyz`;
	}
	
	try {
		const subUrl = `https://${sub}/sub?host=${fHostName}&uuid=${fakeUserID}&edgetunnel=cmliu&proxyip=${RproxyIP}`;
		const response = await fetch(subUrl, {
			headers: {'User-Agent': 'CF-Workers-edgetunnel/cmliu'}
		});
		let content = await response.text();
		content = revertFakeInfo(content, userID, hostName, true);
		
		let decoded;
		try { decoded = atob(content); } catch { return proxies; }
		
		for (const line of decoded.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('vless://')) continue;
			try {
				const rest = trimmed.slice(8);
				const atIdx = rest.indexOf('@');
				const qIdx = rest.indexOf('?');
				const hashIdx = rest.indexOf('#');
				if (atIdx < 0 || qIdx < 0) continue;
				const uuid = rest.slice(0, atIdx);
				const serverPart = rest.slice(atIdx + 1, qIdx);
				const paramsStr = rest.slice(qIdx + 1, hashIdx > 0 ? hashIdx : undefined);
				const name = hashIdx > 0 ? decodeURIComponent(rest.slice(hashIdx + 1)) : `Node-${proxies.length + 1}`;
				const sp = new URLSearchParams(paramsStr);
				const serverColon = serverPart.lastIndexOf(':');
				const server = serverPart.slice(0, serverColon);
				const port = serverPart.slice(serverColon + 1);
				const sni = sp.get('sni') || hostName;
				const path = sp.get('path') || '/?ed=2048';
				const fp = sp.get('fp') || 'chrome';
				proxies.push({
					name: name.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_() ]/g, '').trim() || `Node-${proxies.length + 1}`,
					server, port: parseInt(port) || 443, uuid, sni, path, fp
				});
			} catch {}
		}
	} catch (e) { console.error('Fallback fetch error:', e); }
	return proxies;
}

/** Generate unique names for proxy array */
function deduplicateNames(proxies) {
	const nameCounts = {};
	for (const p of proxies) {
		const originalName = p.name;
		nameCounts[originalName] = (nameCounts[originalName] || 0) + 1;
		if (nameCounts[originalName] > 1) p.name = `${originalName}-${nameCounts[originalName]}`;
	}
	for (const p of proxies) {
		p.name = p.name.replace(/[\n\r]/g, ' ').replace(/"/g, '').trim();
	}
}

/** Build YAML proxy entries from array */
function buildProxyYaml(proxies) {
	let yaml = '';
	for (const p of proxies) {
		yaml += `  - name: "${p.name}"
    type: vless
    server: "${p.server}"
    port: ${p.port}
    uuid: "${p.uuid}"
    network: ws
    tls: true
    servername: "${p.sni}"
    sni: "${p.sni}"
    client-fingerprint: "${p.fp}"
    ws-opts:
      path: "${p.path}"
      headers:
        host: "${p.sni}"
`;
	}
	return yaml;
}

async function generateClashConfig(userID, hostName, sub, RproxyIP, urlADD, urlDLS) {
	if (typeof fetch != 'function') {
		return generateBasicClashConfig(userID, hostName);
	}
	
	// Phase 1: Fetch preferred nodes from WorkerVless2sub sources
	const effectiveADD = urlADD || ADD;
	const effectiveDLS = urlDLS || DLS;
	const preferredNodes = await fetchPreferredNodes(userID, hostName, effectiveADD, effectiveDLS);
	deduplicateNames(preferredNodes);
	
	// Phase 2: Fetch fallback nodes from SUB service
	const fallbackNodes = await fetchFallbackNodes(userID, hostName, sub, RproxyIP);
	deduplicateNames(fallbackNodes);
	
	if (preferredNodes.length === 0 && fallbackNodes.length === 0) {
		return generateBasicClashConfig(userID, hostName);
	}
	
	// Phase 3: Build Clash YAML with two groups
	const prefYaml = buildProxyYaml(preferredNodes);
	const fallYaml = buildProxyYaml(fallbackNodes);
	
	const prefNames = preferredNodes.map(p => `"${p.name}"`).join('\n      - ');
	const fallNames = fallbackNodes.map(p => `"${p.name}"`).join('\n      - ');
	const allNames = [...preferredNodes, ...fallbackNodes].map(p => `"${p.name}"`).join('\n      - ');
	
	let yaml = `mixed-port: 7890
allow-lan: false
bind-address: '*'
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
ipv6: true

# ===== 优选节点 (WorkerVless2sub 优选IP) =====
proxies:
${prefYaml}
# ===== 备用节点 (SUB 服务) =====
${fallYaml}
proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "优选"
      - "自动选择"
      - "故障转移"
      - "备用"
      - DIRECT

  - name: "优选"
    type: select
    proxies:
      - ${prefNames || '- DIRECT'}

  - name: "备用"
    type: select
    proxies:
      - ${fallNames || '- DIRECT'}

  - name: "自动选择"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
      - ${allNames || '- DIRECT'}

  - name: "故障转移"
    type: fallback
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
      - ${allNames || '- DIRECT'}

  - name: "Final"
    type: select
    proxies:
      - "PROXY"
      - DIRECT

rules:
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,Final
`;
	return yaml;
}

/**
 * Generate a basic single-node Clash YAML (fallback when SUB is unavailable)
 */
function generateBasicClashConfig(userID, hostName) {
	return `mixed-port: 7890
allow-lan: false
bind-address: '*'
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
ipv6: true

proxies:
  - name: "${hostName}"
    type: vless
    server: "${hostName}"
    port: 443
    uuid: "${userID}"
    network: ws
    tls: true
    sni: "${hostName}"
    servername: "${hostName}"
    client-fingerprint: chrome
    ws-opts:
      path: "/?ed=2048"
      headers:
        host: "${hostName}"

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "${hostName}"
  - name: "Final"
    type: select
    proxies:
      - "PROXY"
      - DIRECT

rules:
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,Final
`;
}

/**
 * Generate a Sing-box JSON outbound profile directly in Worker
 * @param {string} userID
 * @param {string} hostName
 * @returns {string}
 */
function generateSingboxConfig(userID, hostName) {
	const config = {
		"log": {
			"level": "info"
		},
		"outbounds": [
			{
				"type": "vless",
				"tag": hostName,
				"server": hostName,
				"server_port": 443,
				"uuid": userID,
				"transport": {
					"type": "ws",
					"path": "/?ed=2048",
					"headers": {
						"host": hostName
					}
				},
				"tls": {
					"enabled": true,
					"server_name": hostName,
					"utls": {
						"enabled": true,
						"fingerprint": "chrome"
					}
				}
			},
			{
				"type": "direct",
				"tag": "direct"
			}
		]
	};
	return JSON.stringify(config, null, 2);
}

/**
 * @param {string} userID
 * @param {string | null} hostName
 * @param {string} sub
 * @param {string} userAgent
 * @returns {Promise<string>}
 */
async function getVLESSConfig(userID, hostName, sub, userAgent, RproxyIP) {
	// 如果sub为空，则显示原始内容
	if (!sub || sub === '') {
		const vlessMain = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
  
		return `
	################################################################
	v2ray
	---------------------------------------------------------------
	${vlessMain}
	---------------------------------------------------------------
	################################################################
	clash-meta
	---------------------------------------------------------------
	- type: vless
	  name: ${hostName}
	  server: ${hostName}
	  port: 443
	  uuid: ${userID}
	  network: ws
	  tls: true
	  udp: false
	  sni: ${hostName}
	  client-fingerprint: chrome
	  ws-opts:
	    path: "/?ed=2048"
	    headers:
		  host: ${hostName}
	---------------------------------------------------------------
	################################################################
	`;
	} else if (sub && userAgent.includes('mozilla') && !userAgent.includes('linux x86')) {
		const vlessMain = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
	
		return `
	################################################################
	Subscribe / sub 订阅地址, 支持 Base64、clash-meta、sing-box 订阅格式, 您的订阅内容由 ${sub} 提供维护支持, 自动获取ProxyIP: ${RproxyIP}.
	---------------------------------------------------------------
	https://${hostName}/${userID}
	---------------------------------------------------------------
	################################################################
	v2ray
	---------------------------------------------------------------
	${vlessMain}
	---------------------------------------------------------------
	################################################################
	clash-meta
	---------------------------------------------------------------
	- type: vless
	  name: ${hostName}
	  server: ${hostName}
	  port: 443
	  uuid: ${userID}
	  network: ws
	  tls: true
	  udp: false
	  sni: ${hostName}
	  client-fingerprint: chrome
	  ws-opts:
		path: "/?ed=2048"
		headers:
		  host: ${hostName}
	---------------------------------------------------------------
	################################################################
	telegram 交流群 技术大佬~在线发牌!
	https://t.me/CMLiussss
	---------------------------------------------------------------
	github 项目地址 Star!Star!Star!!!
	https://github.com/cmliu/edgetunnel
	---------------------------------------------------------------
	################################################################
	`;
	} else {
		if (typeof fetch != 'function') {
			return 'Error: fetch is not available in this environment.';
		}
		// 如果是使用默认域名，则改成一个workers的域名，订阅器会加上代理
		if (hostName.includes(".workers.dev") || hostName.includes(".pages.dev")){
			fakeHostName = `${fakeHostName}.${generateRandomString()}${generateRandomNumber()}.workers.dev`;
		} else {
			fakeHostName = `${fakeHostName}.${generateRandomNumber()}.xyz`
		}
		let content = "";
		let url = "";
		let isBase64 = false;
		if (userAgent.includes('clash')) {
			url = `https://${subconverter}/sub?target=clash&url=https%3A%2F%2F${sub}%2Fsub%3Fhost%3D${fakeHostName}%26uuid%3D${fakeUserID}%26edgetunnel%3Dcmliu%26proxyip%3D${RproxyIP}&insert=false&config=${encodeURIComponent(subconfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
		} else if (userAgent.includes('sing-box') || userAgent.includes('singbox')) {
			url = `https://${subconverter}/sub?target=singbox&url=https%3A%2F%2F${sub}%2Fsub%3Fhost%3D${fakeHostName}%26uuid%3D${fakeUserID}%26edgetunnel%3Dcmliu%26proxyip%3D${RproxyIP}&insert=false&config=${encodeURIComponent(subconfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
		} else {
			url = `https://${sub}/sub?host=${fakeHostName}&uuid=${fakeUserID}&edgetunnel=cmliu&proxyip=${RproxyIP}`;
			isBase64 = true;
		}
		try {
			const response = await fetch(url ,{
			headers: {
				'User-Agent': 'CF-Workers-edgetunnel/cmliu'
			}});
			content = await response.text();
			return revertFakeInfo(content, userID, hostName, isBase64);
		} catch (error) {
			console.error('Error fetching content:', error);
			return `Error fetching content: ${error.message}`;
		}
	}
}
