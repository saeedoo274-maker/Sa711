const { esc } = require("../http");

/**
 * صفحات لوحة التحكم — HTML يُبنى على الخادم بلا مكتبات ولا سكربتات خارجية.
 * CSP صارم مع nonce للأنماط والسكربت الوحيد (تبديل الوضع الليلي).
 * كل قيمة ديناميكية تمر عبر esc().
 */
const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--text:#1d2330;--muted:#6b7280;--accent:#5865f2;--ok:#16a34a;--bad:#dc2626;--line:#e5e7eb}
:root[data-theme=dark]{--bg:#0f1117;--card:#181b24;--text:#e6e8ef;--muted:#9aa3b2;--accent:#7983f5;--line:#2a2f3c}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1117;--card:#181b24;--text:#e6e8ef;--muted:#9aa3b2;--accent:#7983f5;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--accent);text-decoration:none}header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0}
main{max-width:1100px;margin:0 auto;padding:16px}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:24px}.muted{color:var(--muted)}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}nav.tabs a{padding:6px 12px;border-radius:999px;border:1px solid var(--line)}nav.tabs a.on{background:var(--accent);color:#fff;border-color:var(--accent)}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:start}
button,select,input{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)}button.primary,a.btn{background:var(--accent);color:#fff;border:0;cursor:pointer;padding:8px 14px;border-radius:8px;display:inline-block}
label.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:12px}.flash.ok{background:#16a34a22;color:var(--ok)}.flash.bad{background:#dc262622;color:var(--bad)}
svg.chart{width:100%;height:180px}svg.chart .line{fill:none;stroke:var(--accent);stroke-width:2}svg.chart .area{fill:var(--accent);opacity:.12}svg.chart text{fill:var(--muted);font-size:10px}
.guilds a{display:flex;gap:10px;align-items:center}.guilds img{width:40px;height:40px;border-radius:50%}
@media (max-width:600px){header{flex-wrap:wrap}.grid{grid-template-columns:1fr 1fr}}
`;

const THEME_JS = `(function(){var k="theme",r=document.documentElement;try{var s=localStorage.getItem(k);if(s)r.dataset.theme=s}catch(e){}
var b=document.getElementById("theme");if(b)b.addEventListener("click",function(){var n=r.dataset.theme==="dark"?"light":"dark";r.dataset.theme=n;try{localStorage.setItem(k,n)}catch(e){}})})();`;

function layout({ title, nonce, body, session = null, csrf = null, dir = "rtl", lang = "ar" }) {
  const user = session
    ? `<span class="muted">${esc(session.username || session.user_id)}</span><form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button>خروج</button></form>`
    : "";
  return `<!doctype html><html lang="${esc(lang)}" dir="${esc(dir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style nonce="${nonce}">${CSS}</style></head><body>
<header><a href="/dashboard"><b>⚙️ ${esc(title)}</b></a><div style="display:flex;gap:8px;align-items:center">${user}<button id="theme" type="button" aria-label="theme">🌓</button></div></header>
<main>${body}</main><script nonce="${nonce}">${THEME_JS}</script></body></html>`;
}

/** رسم خطي SVG بلا JavaScript. */
function lineChart(labels, values) {
  const w = 600;
  const h = 160;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${Math.round(i * step)},${Math.round(h - (v / max) * (h - 20))}`);
  const area = `0,${h} ${pts.join(" ")} ${w},${h}`;
  const ticks = labels.map((l, i) => (i % Math.ceil(labels.length / 7 || 1) === 0 ? `<text x="${Math.round(i * step)}" y="${h + 14}">${esc(l)}</text>` : "")).join("");
  return `<svg class="chart" viewBox="0 -10 ${w} ${h + 26}" role="img" aria-label="chart"><polygon class="area" points="${area}"/><polyline class="line" points="${pts.join(" ")}"/>${ticks}<text x="0" y="0">${max}</text></svg>`;
}

const flash = (msg) => (msg ? `<div class="flash ${msg.ok ? "ok" : "bad"}">${esc(msg.text)}</div>` : "");

function loginPage({ nonce, configured, title }) {
  return layout({
    title, nonce,
    body: `<div class="card" style="max-width:420px;margin:40px auto;text-align:center"><h2>لوحة التحكم</h2>
${configured ? `<p class="muted">سجّل الدخول بحساب ديسكورد لإدارة سيرفراتك.</p><p><a class="btn" href="/auth/login">تسجيل الدخول عبر Discord</a></p>` : `<p class="muted">لوحة التحكم غير مهيأة: اضبط CLIENT_ID و CLIENT_SECRET و DASHBOARD_URL و SESSION_SECRET.</p>`}</div>`
  });
}

function guildList({ nonce, session, csrf, guilds, title }) {
  const items = guilds.map((g) => `<div class="card"><a href="${g.present ? `/dashboard/${esc(g.id)}` : "#"}">${g.icon ? `<img alt="" src="https://cdn.discordapp.com/icons/${esc(g.id)}/${esc(g.icon)}.png?size=64">` : "🏠"}<span>${esc(g.name)}${g.present ? "" : ` <small class="muted">(البوت غير موجود)</small>`}</span></a></div>`).join("");
  return layout({ title, nonce, session, csrf, body: `<h2>سيرفراتك</h2><div class="grid guilds">${items || `<p class="muted">لا توجد سيرفرات تديرها.</p>`}</div>` });
}

function guildPage({ nonce, session, csrf, title, guild, tab, data, message }) {
  const tabs = [["overview", "نظرة عامة"], ["features", "الأنظمة"], ["settings", "الإعدادات"], ["leaderboard", "المتصدرون"], ["cases", "القضايا"]]
    .map(([k, l]) => `<a class="${tab === k ? "on" : ""}" href="/dashboard/${esc(guild.id)}?tab=${k}">${l}</a>`).join("");
  let content = "";
  if (tab === "overview") {
    const s = data.stats;
    const cards = [
      ["الأعضاء", guild.memberCount], ["نشطون (7 أيام)", s?.totals.activeMembers ?? "—"], ["رسائل (7 أيام)", s?.totals.messages ?? "—"],
      ["النمو", s?.totals.growth ?? "—"], ["تذاكر مفتوحة", data.openTickets], ["قضايا (30 يومًا)", data.cases30]
    ].map(([l, v]) => `<div class="card stat"><span class="muted">${l}</span><b>${esc(v)}</b></div>`).join("");
    content = `<div class="grid">${cards}</div>${s ? `<div class="card" style="margin-top:12px"><h3>الرسائل اليومية</h3>${lineChart(s.labels, s.series.messages)}</div><div class="card" style="margin-top:12px"><h3>الانضمام</h3>${lineChart(s.labels, s.series.joins)}</div>` : `<p class="muted">فعّل نظام التحليلات لعرض الرسوم.</p>`}`;
  } else if (tab === "features") {
    const rows = data.features.map((f) => `<label class="row"><span>${esc(f.label)} <small class="muted">${esc(f.name)}</small></span><input type="checkbox" name="f_${esc(f.name)}" ${f.enabled ? "checked" : ""}></label>`).join("");
    content = `<form class="card" method="post" action="/dashboard/${esc(guild.id)}/features"><input type="hidden" name="csrf" value="${esc(csrf)}">${rows}<p><button class="primary">حفظ</button></p></form>`;
  } else if (tab === "settings") {
    const opt = (list, selected) => `<option value="">—</option>${list.map((x) => `<option value="${esc(x.id)}" ${x.id === selected ? "selected" : ""}>${esc(x.name)}</option>`).join("")}`;
    const c = data.config;
    content = `<form class="card" method="post" action="/dashboard/${esc(guild.id)}/settings"><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="row">اللغة<select name="language">${data.languages.map((l) => `<option value="${esc(l)}" ${c.language === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
<label class="row">قناة الترحيب<select name="welcome.channelId">${opt(data.textChannels, c.welcome?.channelId)}</select></label>
<label class="row">رتبة الطاقم<select name="staff.baseRoleId">${opt(data.roles, c.staff?.baseRoleId)}</select></label>
<label class="row">فئة التذاكر<select name="tickets.categoryId">${opt(data.categories, c.tickets?.categoryId)}</select></label>
<label class="row">سجل الرسائل<select name="logs.messages">${opt(data.textChannels, c.logs?.messages)}</select></label>
<label class="row">سجل الأعضاء<select name="logs.members">${opt(data.textChannels, c.logs?.members)}</select></label>
<label class="row">سجل الإشراف<select name="logs.moderation">${opt(data.textChannels, c.logs?.moderation)}</select></label>
<p><button class="primary">حفظ</button></p></form>`;
  } else if (tab === "leaderboard") {
    content = `<div class="card"><table><tr><th>#</th><th>العضو</th><th>XP</th></tr>${data.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.score)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">لا توجد بيانات</td></tr>`}</table></div>`;
  } else if (tab === "cases") {
    content = `<div class="card"><table><tr><th>#</th><th>النوع</th><th>العضو</th><th>السبب</th><th>التاريخ</th></tr>${data.cases.map((c) => `<tr><td>${c.case_number}</td><td>${esc(c.type)}</td><td>${esc(c.target_tag || c.target_id)}</td><td>${esc(String(c.reason || "—").slice(0, 80))}</td><td>${esc(new Date(c.created_at).toISOString().slice(0, 10))}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">لا توجد قضايا</td></tr>`}</table></div>`;
  }
  return layout({ title, nonce, session, csrf, body: `<h2>${esc(guild.name)}</h2><nav class="tabs">${tabs}</nav>${flash(message)}${content}` });
}

function errorPage({ nonce, title, code, text }) {
  return layout({ title, nonce, body: `<div class="card" style="max-width:480px;margin:40px auto;text-align:center"><h2>${code}</h2><p class="muted">${esc(text)}</p><a href="/dashboard">العودة</a></div>` });
}

module.exports = { layout, loginPage, guildList, guildPage, errorPage, lineChart };
