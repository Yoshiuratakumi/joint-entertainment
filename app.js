/* =========================
   京大×慶應 交流マッチング
   - localStorage 永続化
   - 参加者：本人（同一ブラウザ）なら名前タップで退出
   - 締切：期限後は参加/退出ロック
   - イベント削除：作成者（同一ブラウザ）だけ削除可
   ========================= */

const STORAGE_KEY = "joint_events_v2";
const DEVICE_KEY = "joint_device_id_v1";

/** @typedef {{id:string, name:string, univ:"京大"|"慶應", grade:"1"|"2"|"3"|"4"|"5+", part:string, deviceId:string}} Person */
/** @typedef {{id:string, title:string, detail:string, startISO:string, endISO:string, deadlineISO:string, minPeople:number|null, maxPeople:number|null, creator:Person, creatorDeviceId:string, participants:Person[], createdAtISO:string}} Event */

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function saveEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function uid() {
  return "ev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatJP(iso) {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${hh}:${mm}`;
}

function nowISO() {
  return new Date().toISOString();
}

function isLocked(ev) {
  return new Date(nowISO()).getTime() > new Date(ev.deadlineISO).getTime();
}

/* ===== 日程セレクト（2/18 13:00〜2/22 09:00、1時間刻み） ===== */
function buildTimeOptions() {
  const start = new Date("2026-02-18T13:00:00");
  const end = new Date("2026-02-22T09:00:00");
  const stepMin = 60; // 1時間
  const opts = [];
  let cur = new Date(start);
  while (cur <= end) {
    opts.push(new Date(cur));
    cur = new Date(cur.getTime() + stepMin * 60 * 1000);
  }
  return opts;
}

function fillSelectFromTimes(sel) {
  const options = buildTimeOptions();
  sel.innerHTML = "";
  for (const d of options) {
    const iso = d.toISOString();
    const label = formatJP(iso);
    const opt = document.createElement("option");
    opt.value = iso;
    opt.textContent = label;
    sel.appendChild(opt);
  }
}

function fillTimeSelects(startSel, endSel) {
  fillSelectFromTimes(startSel);
  fillSelectFromTimes(endSel);

  // 初期：開始=最初、終了=+2h
  startSel.selectedIndex = 0;
  endSel.selectedIndex = Math.min(2, endSel.options.length - 1);

  function ensureConsistency() {
    const s = new Date(startSel.value).getTime();
    const e = new Date(endSel.value).getTime();

    // end > start
    if (e <= s) {
      const opts = Array.from(endSel.options);
      const sIdx = opts.findIndex(o => o.value === startSel.value);
      endSel.selectedIndex = Math.min(sIdx + 2, endSel.options.length - 1);
    }
  }

  startSel.addEventListener("change", ensureConsistency);
  endSel.addEventListener("change", ensureConsistency);
}

    // deadline <= start を推奨（自動整合）
    if (d > s) {
      // deadline を start に合わせる
      const opts = Array.from(deadlineSel.options);
      const sIdx = opts.findIndex(o => o.value === startSel.value);
      deadlineSel.selectedIndex = Math.max(0, sIdx);
    }
  }

  startSel.addEventListener("change", ensureConsistency);
  endSel.addEventListener("change", ensureConsistency);
  deadlineSel.addEventListener("change", ensureConsistency);
}

function fillPeopleSelect(sel, maxN = 60) {
  for (let i = 1; i <= maxN; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
}

/* ===== 参加者退出（本人デバイスのみ） ===== */
function removeParticipantById(events, eventId, personId, deviceId) {
  const ev = events.find(x => x.id === eventId);
  if (!ev) return { ok: false, reason: "イベントが見つかりませんでした。" };

  if (isLocked(ev)) return { ok: false, reason: "締め切り後のため、退出できません。" };

  const p = ev.participants.find(x => x.id === personId);
  if (!p) return { ok: false, reason: "参加者が見つかりませんでした。" };

  if (p.deviceId !== deviceId) return { ok: false, reason: "この端末から参加した本人のみ退出できます。" };

  // 作成者が退出して参加者0になると困る場合もあるが、要件上OK
  ev.participants = ev.participants.filter(x => x.id !== personId);
  saveEvents(events);
  return { ok: true, reason: "退出しました。" };
}

/* ===== イベント削除（作成者デバイスのみ） ===== */
function deleteEvent(events, eventId, deviceId) {
  const ev = events.find(x => x.id === eventId);
  if (!ev) return { ok: false, reason: "イベントが見つかりませんでした。" };

  if (ev.creatorDeviceId !== deviceId) {
    return { ok: false, reason: "作成者（この端末）だけがイベントを削除できます。" };
  }

  const next = events.filter(x => x.id !== eventId);
  saveEvents(next);
  return { ok: true, reason: "イベントを削除しました。" };
}

/* ===== 描画：募集中のイベント（events.html） ===== */
function renderEventsList(container, events, deviceId) {
  container.innerHTML = "";
  const sorted = [...events].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  for (const ev of sorted) {
    const locked = isLocked(ev);
    const range = `${formatJP(ev.startISO)} 〜 ${formatJP(ev.endISO)}`;
    const cap =
      (ev.minPeople || ev.maxPeople)
        ? `募集：${ev.minPeople ?? "?"}〜${ev.maxPeople ?? "?"}人`
        : "募集：未設定";

    const statusBadge = locked
      ? `<span class="badge locked">締切済み</span>`
      : `<span class="badge">募集中</span>`;

    const creator = `${ev.creator.name}（${ev.creator.univ}・${ev.creator.grade}年・${ev.creator.part}）`;

    const peopleItems = ev.participants.map(p => {
      const label = `${p.name}（${p.univ}・${p.grade}年・${p.part}）`;
      const canRemove = (!locked) && (p.deviceId === deviceId);
      if (canRemove) {
        return `<li><button class="name-btn" data-action="leave" data-event-id="${escapeHtml(ev.id)}" data-person-id="${escapeHtml(p.id)}" type="button">${escapeHtml(label)}</button></li>`;
      }
      // ロック中 or 他人はただの文字
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    const canDelete = (ev.creatorDeviceId === deviceId);
    const deleteBtn = canDelete
      ? `<div class="card-actions"><button class="btn small danger-outline" data-action="delete-event" data-event-id="${escapeHtml(ev.id)}" type="button">このイベントを削除</button></div>`
      : "";

    const html = `
      <article class="card">
        <div class="card-head">
          <h3 class="card-title">${escapeHtml(ev.title)}</h3>
          ${statusBadge}
        </div>

        <div class="card-meta">
          <div>日程：<strong>${escapeHtml(range)}</strong></div>
          <div>締め切り：<strong>${escapeHtml(formatJP(ev.deadlineISO))}</strong></div>
          <div>${escapeHtml(cap)}</div>
          <div>作成者：${escapeHtml(creator)}</div>
        </div>

        <p class="card-detail">${escapeHtml(ev.detail || "（詳細なし）")}</p>

        <div class="people">
          <p class="people-title">現在の参加者（${ev.participants.length}名）</p>
          <ul class="people-list">${peopleItems || "<li>まだ参加者がいません</li>"}</ul>
          <p class="hint">※自分の名前（この端末で参加したもの）はタップで退出できます（締切前のみ）</p>
        </div>

        ${deleteBtn}
      </article>
    `;
    container.insertAdjacentHTML("beforeend", html);
  }
}

function bindEventsPageActions(rootEl, refreshFn, deviceId) {
  rootEl.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const action = t.getAttribute("data-action");
    if (!action) return;

    if (action === "leave") {
      const eventId = t.getAttribute("data-event-id");
      const personId = t.getAttribute("data-person-id");
      if (!eventId || !personId) return;

      if (!confirm("このイベントから退出しますか？")) return;

      const events = loadEvents();
      const res = removeParticipantById(events, eventId, personId, deviceId);
      alert(res.reason);
      refreshFn();
      return;
    }

    if (action === "delete-event") {
      const eventId = t.getAttribute("data-event-id");
      if (!eventId) return;

      if (!confirm("このイベントを削除しますか？（参加者情報も消えます）")) return;

      const events = loadEvents();
      const res = deleteEvent(events, eventId, deviceId);
      alert(res.reason);
      refreshFn();
      return;
    }
  });
}

/* ===== 参加ページ：アコーディオン ===== */
function renderJoinList(container, events, deviceId) {
  container.innerHTML = "";
  const sorted = [...events].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  for (const ev of sorted) {
    const locked = isLocked(ev);
    const range = `${formatJP(ev.startISO)} 〜 ${formatJP(ev.endISO)}`;
    const cap =
      (ev.minPeople || ev.maxPeople)
        ? `募集：${ev.minPeople ?? "?"}〜${ev.maxPeople ?? "?"}人`
        : "募集：未設定";

    const statusBadge = locked
      ? `<span class="badge locked">締切済み</span>`
      : `<span class="badge">募集中</span>`;

    const participantsHtml = ev.participants.map(p => {
      const label = `${p.name}（${p.univ}・${p.grade}年・${p.part}）`;
      const canRemove = (!locked) && (p.deviceId === deviceId);
      if (canRemove) {
        return `<li><button class="name-btn" data-action="leave" data-event-id="${escapeHtml(ev.id)}" data-person-id="${escapeHtml(p.id)}" type="button">${escapeHtml(label)}</button></li>`;
      }
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    // capacity check
    const atCap = (typeof ev.maxPeople === "number") && (ev.participants.length >= ev.maxPeople);
    const joinDisabled = locked || atCap;

    const reason = locked ? "締切済みのため参加できません。" : (atCap ? "募集人数に達しています。" : "");

    const canDelete = (ev.creatorDeviceId === deviceId);
    const deleteBtn = canDelete
      ? `<button class="btn small danger-outline" data-action="delete-event" data-event-id="${escapeHtml(ev.id)}" type="button">このイベントを削除</button>`
      : "";

    const item = document.createElement("div");
    item.className = "acc-item";
    item.innerHTML = `
      <button class="acc-head" type="button" aria-expanded="false">
        <div>
          <strong>${escapeHtml(ev.title)}</strong><br/>
          <span class="meta">日程：${escapeHtml(range)} ／ 締め切り：${escapeHtml(formatJP(ev.deadlineISO))} ／ ${escapeHtml(cap)}</span>
        </div>
        ${statusBadge}
      </button>

      <div class="acc-body">
        <p class="card-detail">${escapeHtml(ev.detail || "（詳細なし）")}</p>

        <div class="people">
          <p class="people-title">現在の参加者（${ev.participants.length}名）</p>
          <ul class="people-list">${participantsHtml || "<li>まだ参加者がいません</li>"}</ul>
          <p class="hint">※自分の名前（この端末で参加したもの）はタップで退出できます（締切前のみ）</p>
        </div>

        <form class="join-form" data-event-id="${escapeHtml(ev.id)}" novalidate>
          <div class="grid2">
            <div class="field">
              <label>名前</label>
              <input name="name" type="text" required maxlength="30" placeholder="例：山田 太郎" ${joinDisabled ? "disabled" : ""}/>
            </div>
            <div class="field">
              <label>大学名（京大/慶應）</label>
              <select name="univ" required ${joinDisabled ? "disabled" : ""}>
                <option value="">選択してください</option>
                <option value="京大">京大</option>
                <option value="慶應">慶應</option>
              </select>
            </div>
          </div>

          <div class="grid2">
            <div class="field">
              <label>学年</label>
              <select name="grade" required ${joinDisabled ? "disabled" : ""}>
                <option value="">選択してください</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5+">5~</option>
              </select>
            </div>
            <div class="field">
              <label>パート</label>
              <select name="part" required ${joinDisabled ? "disabled" : ""}>
                <option value="">選択してください</option>
                <option value="Vn">Vn</option>
                <option value="Va">Va</option>
                <option value="Vc">Vc</option>
                <option value="Ob">Ob</option>
                <option value="Cl">Cl</option>
                <option value="Fl">Fl</option>
                <option value="Fg">Fg</option>
                <option value="Tp">Tp</option>
                <option value="Trb">Trb</option>
                <option value="Hr">Hr</option>
                <option value="その他">その他</option>
              </select>
            </div>
          </div>

          <div class="join-actions">
            ${deleteBtn}
            <button class="btn square red" type="submit" ${joinDisabled ? "disabled" : ""}>参加する</button>
          </div>

          <div class="msg" aria-live="polite">${escapeHtml(reason)}</div>
        </form>
      </div>
    `;
    container.appendChild(item);
  }

  // accordion toggle
  container.querySelectorAll(".acc-item").forEach(item => {
    const head = item.querySelector(".acc-head");
    head.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
}

function bindJoinPageActions(rootEl, deviceId) {
  rootEl.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const action = t.getAttribute("data-action");
    if (!action) return;

    if (action === "leave") {
      const eventId = t.getAttribute("data-event-id");
      const personId = t.getAttribute("data-person-id");
      if (!eventId || !personId) return;

      if (!confirm("このイベントから退出しますか？")) return;

      const events = loadEvents();
      const res = removeParticipantById(events, eventId, personId, deviceId);
      alert(res.reason);

      renderJoinList(rootEl, loadEvents(), deviceId);
      bindJoinForms(rootEl, deviceId); // forms再バインド
      return;
    }

    if (action === "delete-event") {
      const eventId = t.getAttribute("data-event-id");
      if (!eventId) return;

      if (!confirm("このイベントを削除しますか？（参加者情報も消えます）")) return;

      const events = loadEvents();
      const res = deleteEvent(events, eventId, deviceId);
      alert(res.reason);

      renderJoinList(rootEl, loadEvents(), deviceId);
      bindJoinForms(rootEl, deviceId);
      return;
    }
  });
}

function bindJoinForms(container, deviceId) {
  container.querySelectorAll(".join-form").forEach(form => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = form.querySelector(".msg");
      msg.textContent = "";

      const evId = form.getAttribute("data-event-id");
      const fd = new FormData(form);
      const person = {
        id: uid(),
        name: String(fd.get("name") || "").trim(),
        univ: fd.get("univ"),
        grade: fd.get("grade"),
        part: fd.get("part"),
        deviceId,
      };

      if (!person.name || !person.univ || !person.grade || !person.part) {
        msg.textContent = "未入力の項目があります。すべて入力してください。";
        return;
      }

      const events = loadEvents();
      const ev = events.find(x => x.id === evId);
      if (!ev) {
        msg.textContent = "イベントが見つかりませんでした。";
        return;
      }

      if (isLocked(ev)) {
        msg.textContent = "締め切り後のため参加できません。";
        return;
      }

      // duplicate check（同名+大学+学年+パート）
      const dup = ev.participants.some(p =>
        p.name === person.name && p.univ === person.univ && p.grade === person.grade && p.part === person.part
      );
      if (dup) {
        msg.textContent = "すでに同じ情報で参加済みです。";
        return;
      }

      // capacity check
      if (typeof ev.maxPeople === "number" && ev.participants.length >= ev.maxPeople) {
        msg.textContent = "募集人数に達しています。別の企画をご検討ください。";
        return;
      }

      ev.participants.push(person);
      saveEvents(events);

      msg.textContent = "参加しました！※自分の名前はタップで退出できます（締切前のみ）";
      form.reset();

      // refresh view
      renderJoinList(container, loadEvents(), deviceId);
      bindJoinForms(container, deviceId);
    }, { once: true });
  });
}

/* ===== create page handling ===== */
function initCreatePage(deviceId) {
  const form = document.getElementById("createForm");
  const msg = document.getElementById("formMsg");
  const detail = document.getElementById("detail");
  const detailCount = document.getElementById("detailCount");

  const startSel = document.getElementById("startTime");
  const endSel = document.getElementById("endTime");
  const deadlineSel = document.getElementById("deadline");
  fillTimeSelects(startSel, endSel, deadlineSel);

  const minSel = document.getElementById("minPeople");
  const maxSel = document.getElementById("maxPeople");
  fillPeopleSelect(minSel, 60);
  fillPeopleSelect(maxSel, 60);

  detail.addEventListener("input", () => {
    detailCount.textContent = String(detail.value.length);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    msg.textContent = "";

    const fd = new FormData(form);

    const title = String(fd.get("title") || "").trim();
    const detailText = String(fd.get("detail") || "").trim();
    const startISO = String(fd.get("startTime") || "");
    const endISO = String(fd.get("endTime") || "");
    const deadlineISO = String(fd.get("deadline") || "");

    const minRaw = String(fd.get("minPeople") || "").trim();
    const maxRaw = String(fd.get("maxPeople") || "").trim();
    const minPeople = minRaw ? Number(minRaw) : null;
    const maxPeople = maxRaw ? Number(maxRaw) : null;

    /** @type {Person} */
    const creator = {
      id: uid(),
      name: String(fd.get("name") || "").trim(),
      univ: fd.get("univ"),
      grade: fd.get("grade"),
      part: fd.get("part"),
      deviceId,
    };

    // validate required
    if (!title || !startISO || !endISO || !deadlineISO || !creator.name || !creator.univ || !creator.grade || !creator.part) {
      msg.textContent = "未入力の必須項目があります。すべて入力してください。";
      return;
    }

    if (detailText.length > 100) {
      msg.textContent = "詳細は100文字以内にしてください。";
      return;
    }

    const s = new Date(startISO).getTime();
    const en = new Date(endISO).getTime();
    const dl = new Date(deadlineISO).getTime();

    if (!(en > s)) {
      msg.textContent = "日程の終了は開始より後にしてください。";
      return;
    }

    // 締切は開始より前（または同時刻）に自動整合しているが、念のため
    if (dl > s) {
      msg.textContent = "締め切りは開始時刻より前（または同時刻）にしてください。";
      return;
    }

    if (minPeople !== null && (!Number.isFinite(minPeople) || minPeople < 1)) {
      msg.textContent = "募集人数（最小）が不正です。";
      return;
    }
    if (maxPeople !== null && (!Number.isFinite(maxPeople) || maxPeople < 1)) {
      msg.textContent = "募集人数（最大）が不正です。";
      return;
    }
    if (minPeople !== null && maxPeople !== null && minPeople > maxPeople) {
      msg.textContent = "募集人数は「最小 ≤ 最大」にしてください。";
      return;
    }

    /** @type {Event} */
    const ev = {
      id: uid(),
      title,
      detail: detailText,
      startISO,
      endISO,
      deadlineISO,
      minPeople,
      maxPeople,
      creator,
      creatorDeviceId: deviceId,
      participants: [creator], // 作成者を自動参加
      createdAtISO: new Date().toISOString(),
    };

    const events = loadEvents();
    events.push(ev);
    saveEvents(events);

    msg.textContent = "作成しました！募集中のイベント一覧に移動します。";

    setTimeout(() => {
      window.location.href = "events.html";
    }, 350);
  });
}

/* ===== events page handling ===== */
function initEventsPage(deviceId) {
  const list = document.getElementById("eventsList");
  const count = document.getElementById("eventCount");
  const empty = document.getElementById("emptyState");

  function refresh() {
    const events = loadEvents();
    count.textContent = String(events.length);
    if (events.length === 0) {
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    empty.hidden = true;
    renderEventsList(list, events, deviceId);
  }

  bindEventsPageActions(document.body, refresh, deviceId);
  refresh();
}

/* ===== join page handling ===== */
function initJoinPage(deviceId) {
  const list = document.getElementById("joinList");
  const empty = document.getElementById("emptyJoin");

  function refresh() {
    const events = loadEvents();
    if (events.length === 0) {
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    empty.hidden = true;
    renderJoinList(list, events, deviceId);
    bindJoinForms(list, deviceId);
  }

  bindJoinPageActions(list, deviceId);
  refresh();
}

/* ===== boot ===== */
document.addEventListener("DOMContentLoaded", () => {
  const deviceId = getDeviceId();
  const page = document.body?.dataset?.page;

  if (page === "create") initCreatePage(deviceId);
  if (page === "home2") initEventsPage(deviceId);
  if (page === "join") initJoinPage(deviceId);
});

// "YYYY-MM-DD" を「その日 23:59（ローカル時刻）」の ISO に変換
function deadlineDateToISO(dateStr) {
  // dateStr例: "2026-02-10"
  const [y, m, d] = dateStr.split("-").map(Number);
  const local = new Date(y, m - 1, d, 23, 59, 0, 0); // ローカル時刻で23:59
  return local.toISOString();
}
