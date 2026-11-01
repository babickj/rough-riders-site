// Public recruiting profile, opened from a coach's share link (/r/<token>).
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt3 = (x) => (x == null ? "—" : x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ""));
  const fmt2 = (x) => (x == null ? "—" : x.toFixed(2));
  const day = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const token = location.pathname.split("/")[2] || "";

  function table(cols, row) {
    return `<div class="tbl-wrap"><table><thead><tr>${cols.map(([, l]) => `<th style="cursor:default">${l}</th>`).join("")}</tr></thead><tbody><tr>${cols.map(([k, , f]) => `<td>${f ? f(row[k]) : esc(row[k])}</td>`).join("")}</tr></tbody></table></div>`;
  }

  fetch(`/api/recruit?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((p) => {
    if (p.error) { $("#pf-name").textContent = "Profile unavailable"; $("#pf-msg").textContent = p.error; return; }
    document.title = `${p.name} · ${p.grad_year ? "Class of " + p.grad_year : "Player profile"}`;
    $("#pf-num").textContent = p.jersey || p.jersey === 0 ? "#" + p.jersey : "";
    $("#pf-name").textContent = p.name;
    $("#pf-sub").textContent = [p.positions, p.school || p.team, p.grad_year ? "Class of " + p.grad_year : ""].filter(Boolean).join(" · ");

    const facts = [["Grad year", p.grad_year], ["Positions", p.positions], ["Bats/Throws", [p.bats, p.throws].filter(Boolean).join("/")], ["Height", p.height], ["Weight", p.weight], ["GPA", p.gpa]].filter(([, v]) => v);
    let html = `<div class="actions"><button class="primary" type="button" id="pf-print">Save as PDF</button><button type="button" id="pf-copy">Copy link</button><span class="status" id="pf-status"></span></div>`;
    if (facts.length) html += `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
    if (p.youtube) html += `<div class="media"><iframe src="https://www.youtube-nocookie.com/embed/${p.youtube}" title="Highlight video" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    else if (p.highlight) html += `<div class="media">${p.highlight.kind === "video" ? `<video src="${esc(p.highlight.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(p.highlight.url)}" alt="Highlight">`}</div>`;
    if (p.bio) html += `<section class="stack" style="gap:8px"><h3>About</h3><div class="bio">${esc(p.bio)}</div></section>`;
    if (p.measurements && p.measurements.length) html += `<section class="stack" style="gap:8px"><h3>Measurables (best)</h3><div class="facts">${p.measurements.map((m) => `<div class="fact"><span>${esc(m.metric)}</span><b>${esc((+m.value).toLocaleString(undefined, { maximumFractionDigits: 2 }))} ${esc(m.unit || "")}</b><div class="foot">${esc(day(m.date))}</div></div>`).join("")}</div></section>`;
    const s = p.stats || {};
    if (s.batting) html += `<section class="stack" style="gap:8px"><h3>Batting</h3>${table([["g", "G"], ["ab", "AB"], ["h", "H"], ["d", "2B"], ["t", "3B"], ["hr", "HR"], ["rbi", "RBI"], ["bb", "BB"], ["so", "K"], ["sb", "SB"], ["avg", "AVG", fmt3], ["obp", "OBP", fmt3], ["slg", "SLG", fmt3]], s.batting)}</section>`;
    if (s.pitching) html += `<section class="stack" style="gap:8px"><h3>Pitching</h3>${table([["g", "G"], ["ip", "IP"], ["h", "H"], ["er", "ER"], ["bb", "BB"], ["so", "K"], ["era", "ERA", fmt2], ["whip", "WHIP", fmt2]], s.pitching)}</section>`;
    if (s.fielding) html += `<section class="stack" style="gap:8px"><h3>Fielding</h3>${table([["g", "G"], ["po", "PO"], ["a", "A"], ["e", "E"], ["pct", "FLD%", fmt3]], s.fielding)}</section>`;
    if (p.events && p.events.length) html += `<section class="stack" style="gap:8px"><h3>Upcoming showcases and camps</h3><ul>${p.events.map((e) => `<li><b>${esc(day(e.date))}</b>: ${esc(e.title)}${e.location ? ", " + esc(e.location) : ""}</li>`).join("")}</ul></section>`;
    if (p.contact_email || p.contact_name) html += `<div class="contact"><div>Contact${p.contact_name ? ": " + esc(p.contact_name) : ""}</div>${p.contact_email ? `<div class="em">${esc(p.contact_email)}</div>` : ""}</div>`;
    html += `<p class="foot">Stats include team and tournament games${p.season ? " for " + esc(p.season) : ""}. Profile updated ${esc(new Date(p.updated_at).toLocaleDateString())}.</p>`;
    $("#pf-main").innerHTML = html;
    $("#pf-print").onclick = () => window.print();
    $("#pf-copy").onclick = async () => { try { await navigator.clipboard.writeText(location.href); $("#pf-status").textContent = "Link copied."; } catch (e) { $("#pf-status").textContent = location.href; } };
  }).catch(() => { $("#pf-name").textContent = "Profile unavailable"; $("#pf-msg").textContent = "Couldn't load this profile. Check your connection and try again."; });
})();
