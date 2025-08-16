// v6.7.2: Santiago facilities, access via initials, history isolated per center
const EXCLUSIVE_SETS = [
  new Set(["1a","1b","1c"]),
  new Set(["4a","4b","4c"]),
  new Set(["6a","6b","6c"]),
  new Set(["7a","7b"]),
  new Set(["8a","8b","8c"]),
];

function numberToComma(n){ return n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function isExclusive(code){ return EXCLUSIVE_SETS.some(set => set.has(code)); }

function normalizeStr(s){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function computeInitials(name){
  const stop = new Set(["de","del","la","las","los","y","da","do","das","dos"]);
  const tokens = normalizeStr(name).split(/\s+/).filter(Boolean);
  const letters = tokens.filter(t => !stop.has(t.toLowerCase())).map(t => t[0].toUpperCase());
  return letters.join("");
}
function slugify(name){
  return normalizeStr(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function getHistoryKey(facility){
  const slug = slugify(facility||"default");
  return `nas_history__${slug}`;
}

// Migrate old shared 'nas_history' to namespaced per-center once
function migrateIfNeeded(){
  const old = JSON.parse(localStorage.getItem('nas_history') || "[]");
  if (!old || old.length === 0) return;
  for (const r of old){
    const k = getHistoryKey(r.facility || "default");
    const arr = JSON.parse(localStorage.getItem(k) || "[]");
    arr.push(r);
    localStorage.setItem(k, JSON.stringify(arr));
  }
  localStorage.removeItem('nas_history');
}

// ====== AUTH / LANDING ======
function renderLogin(){
  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <section class="card auth-wrapper">
      <h1 class="auth-title">Inicio</h1>
      <p class="muted">Seleccione su centro (Santiago) y escriba las <strong>iniciales</strong> como clave.</p>
      <div class="row">
        <label>Clínica / Hospital (Santiago)
          <select id="facilitySelect">
            ${(window.FACILITIES||[]).map(f => `<option value="${f}">${f}</option>`).join("")}
          </select>
        </label>
        <label>Clave (iniciales del centro)
          <input id="accessKey" type="password" placeholder="Ej.: Clínica Santa María → CSM">
        </label>
      </div>
      <div class="helper" id="hint" style="margin-top:6px;"></div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
        <button id="enterBtn">Entrar</button>
        <span id="authMsg" class="helper"></span>
      </div>
    </section>
  `;

  const facilitySelect = document.getElementById('facilitySelect');
  const hint = document.getElementById('hint');
  function updateHint(){
    const f = facilitySelect.value || "";
    if (!f) { hint.textContent = ""; return; }
    const initials = computeInitials(f);
    hint.textContent = `Pista: ${f} → ${initials}`;
  }
  updateHint();
  facilitySelect.addEventListener('change', updateHint);

  document.getElementById('enterBtn').addEventListener('click', () => {
    const facility = facilitySelect.value;
    const key = (document.getElementById('accessKey').value || "").trim();
    const expected = computeInitials(facility);
    const msg = document.getElementById('authMsg');
    if (key.length === 0){ msg.textContent = "Ingrese la clave (iniciales del centro)."; return; }
    if (normalizeStr(key).toUpperCase() !== expected){
      msg.textContent = "Clave incorrecta (use las iniciales del centro).";
      return;
    }
    localStorage.setItem('nas_auth', JSON.stringify({ facility, ts: Date.now() }));
    renderApp();
  });

  document.getElementById('logoutBtn').style.display = "none";
  document.getElementById('facilityBadge').style.display = "none";
}

function renderApp(){
  migrateIfNeeded();

  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <h1>Aplicación de la Escala NAS</h1>
    <p class="muted">Historial aislado por centro. Orden 1a→23. Ítems excluyentes en gris.</p>

    <form id="nasForm">
      <section class="card">
        <h2>Datos de aplicación</h2>
        <div class="row">
          <label>Identificador (RUT u otro)
            <input type="text" name="identifier" placeholder="Opcional">
          </label>
          <label>Turno
            <select name="shift">
              <option value="Día">Día</option>
              <option value="Noche">Noche</option>
            </select>
          </label>
          <label>Fecha y hora de evaluación
            <input type="datetime-local" name="created_at">
          </label>
          <label>Paciente
            <select name="patient_status">
              <option value="N/A">N/A</option>
              <option value="Ingreso">Ingreso</option>
              <option value="Egreso">Egreso</option>
            </select>
          </label>
          <label>Unidad
            <select name="unit">
              <option value="UCI">UCI</option>
              <option value="UTI">UTI</option>
            </select>
          </label>
        </div>
        <label>Nota (opcional)
          <textarea name="note" rows="3" placeholder="Observaciones, procedimientos, etc."></textarea>
        </label>
      </section>

      <section class="card">
        <h2>Ítems NAS</h2>
        <div id="catalogGrid" class="grid zebra"></div>
        <div id="validationBox" class="warn" style="display:none;"></div>
      </section>

      <section class="card">
        <h2>Resumen</h2>
        <p><strong>Puntaje total:</strong> <span id="totalScore">0,0</span></p>
        <div class="row">
          <button type="submit">Guardar evaluación</button>
          <button type="button" id="dupLast">Duplicar última</button>
          <button type="button" id="printBtn">Imprimir</button>
        </div>
      </section>
    </form>

    <section class="card">
      <h2>Historial local (este centro)</h2>
      <div id="history"></div>
      <button id="exportCsv">Exportar CSV</button>
    </section>
  `;

  const auth = JSON.parse(localStorage.getItem('nas_auth') || "{}");
  const badge = document.getElementById('facilityBadge');
  if (auth && auth.facility){
    badge.textContent = auth.facility;
    badge.style.display = "inline-block";
    document.getElementById('logoutBtn').style.display = "inline-block";
  }

  renderCatalog();
  setDefaultDateTime();
  refreshSummary();
  loadHistory();

  document.getElementById("exportCsv").addEventListener("click", exportCSV);
  document.getElementById("dupLast").addEventListener("click", restoreLast);
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("nasForm").addEventListener("submit", onSubmit);
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('nas_auth');
  renderLogin();
});

// ====== Catalog & calc ======
function renderCatalog(){
  const grid = document.getElementById('catalogGrid');
  const order = window.NAS_ORDER || Object.keys(window.NAS_CATALOG);
  const items = order.map(code => [code, window.NAS_CATALOG[code]]).filter(([c,m])=>!!m);
  grid.innerHTML = items.map(([code, meta]) => `
    <label class="item ${isExclusive(code)?'exclusive':''}" data-code="${code}">
      <span class="badge">${isExclusive(code)?'Excluyente':''}</span>
      <input type="checkbox" value="${code}" data-nas>
      <strong>${code}</strong> ${meta.label} <em>(${meta.weight})</em>
    </label>`).join("");
}
function getSelectedCodes(){
  return Array.from(document.querySelectorAll('input[type=checkbox][data-nas]:checked')).map(cb => cb.value);
}
function exclusiveAuto(e){
  const code = e.target.value;
  for (const g of EXCLUSIVE_SETS){
    if (g.has(code)){
      document.querySelectorAll('input[type=checkbox][data-nas]').forEach(cb=>{
        if (cb.value !== code && g.has(cb.value)) cb.checked = false;
      });
      break;
    }
  }
}
function computeScore(codes){
  return codes.reduce((acc, code) => acc + (window.NAS_CATALOG[code]?.weight || 0), 0);
}
function refreshSummary(){
  const codes = getSelectedCodes();
  const total = computeScore(codes);
  const el = document.getElementById('totalScore');
  if (el) el.textContent = numberToComma(total);
}

// ====== History storage (per-center) ======
function currentHistoryKey(){
  const auth = JSON.parse(localStorage.getItem('nas_auth') || "{}");
  return getHistoryKey(auth.facility || "default");
}
function loadHistory(){
  const el = document.getElementById('history');
  const rows = JSON.parse(localStorage.getItem(currentHistoryKey()) || "[]");
  if (rows.length === 0){
    el.innerHTML = "<p class='muted'>Aún no hay registros locales para este centro.</p>";
    return;
  }
  const table = [`<table><thead><tr><th>Fecha</th><th>Identificador</th><th>Turno</th><th>Paciente</th><th>Unidad</th><th>Puntaje</th><th>Ítems</th><th>Nota</th></tr></thead><tbody>`];
  for (const r of rows){
    table.push(`<tr>
      <td>${r.created_at}</td>
      <td>${r.identifier||"—"}</td>
      <td>${r.shift||"—"}</td>
      <td>${r.patient_status||"N/A"}</td>
      <td>${r.unit||"—"}</td>
      <td>${numberToComma(r.total_score||0)}</td>
      <td>${Array.isArray(r.codes)?r.codes.join(", "):"—"}</td>
      <td>${r.note||"—"}</td>
    </tr>`);
  }
  table.push("</tbody></table>");
  el.innerHTML = table.join("");
}
function appendHistory(row){
  const key = currentHistoryKey();
  const rows = JSON.parse(localStorage.getItem(key) || "[]");
  rows.unshift(row);
  localStorage.setItem(key, JSON.stringify(rows));
  loadHistory();
}
function restoreLast(){
  const key = currentHistoryKey();
  const rows = JSON.parse(localStorage.getItem(key) || "[]");
  if(rows.length === 0){ alert("No hay registros previos en este centro."); return; }
  const r = rows[0];
  const f = document.getElementById('nasForm');
  f.identifier.value = r.identifier || "";
  f.shift.value = r.shift || "Día";
  f.note.value = r.note || "";
  f.patient_status.value = r.patient_status || "N/A";
  f.unit.value = r.unit || "UCI";
  if (r.created_at) f.created_at.value = r.created_at.replace(" ", "T");
  const prev = r.codes || [];
  document.querySelectorAll('input[type=checkbox][data-nas]').forEach(cb=>{
    cb.checked = prev.includes(cb.value);
  });
  refreshSummary();
}
function exportCSV(){
  const key = currentHistoryKey();
  const rows = JSON.parse(localStorage.getItem(key) || "[]");
  if (rows.length === 0) return alert("No hay datos para exportar en este centro.");
  const headers = ["created_at","identifier","shift","patient_status","unit","total_score","codes","note"];
  const csv = [headers.join(",")].concat(rows.map(r => [
    r.created_at,
    `"${(r.identifier||"").replace(/"/g,'""')}"`,
    `"${(r.shift||"").replace(/"/g,'""')}"`,
    `"${(r.patient_status||"N/A").replace(/"/g,'""')}"`,
    `"${(r.unit||"—").replace(/"/g,'""')}"`,
    (r.total_score ?? 0),
    `"${(Array.isArray(r.codes)?r.codes.join(" "):"").replace(/"/g,'""')}"`,
    `"${(r.note||"").replace(/"/g,'""')}"`
  ].join(","))).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nas_export_${new Date().toISOString().slice(0,10)}_${slugify(JSON.parse(localStorage.getItem('nas_auth')||"{}").facility||"centro")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ====== Submit ======
function onSubmit(e){
  e.preventDefault();
  const f = e.target;
  const codes = getSelectedCodes();
  const row = {
    created_at: (f.created_at.value || new Date().toISOString().slice(0,16)).replace("T"," "),
    identifier: f.identifier.value,
    shift: f.shift.value,
    patient_status: f.patient_status.value || "N/A",
    unit: f.unit.value || "UCI",
    note: f.note.value,
    codes,
    total_score: codes.reduce((acc, c) => acc + (window.NAS_CATALOG[c]?.weight || 0), 0),
  };
  appendHistory(row);
  f.reset();
  renderCatalog(); // limpia selección
  setDefaultDateTime();
  refreshSummary();
  alert("Evaluación guardada (historial local de este centro).");
}

// ====== Init ======
function setDefaultDateTime(){
  const f = document.getElementById('nasForm');
  if (f && !f.created_at.value){
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    f.created_at.value = local;
  }
}

document.addEventListener("change", e => {
  if (e.target.matches('input[type=checkbox][data-nas]')){
    exclusiveAuto(e);
    refreshSummary();
  }
});
document.addEventListener("DOMContentLoaded", () => {
  const auth = JSON.parse(localStorage.getItem('nas_auth') || "{}");
  if (auth && auth.facility){
    renderApp();
    const badge = document.getElementById('facilityBadge');
    badge.textContent = auth.facility;
    badge.style.display = "inline-block";
    document.getElementById('logoutBtn').style.display = "inline-block";
  } else {
    renderLogin();
  }
});
