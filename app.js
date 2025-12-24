/* =========================
   京大×慶應 交流マッチング（Firestore同期版）
   - イベント作成/参加/退出/削除
   - 締め切り後は参加/退出ロック
   - 別端末でも同じ一覧に即時反映（onSnapshot）
   ========================= */

// ===== Firebase config（あなたの値）=====
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBMdc9G-4QxkWr99o0yy29Xu5F-XCWP4U",
  authDomain: "kyodai-keio-joint-2026.firebaseapp.com",
  projectId: "kyodai-keio-joint-2026",
  storageBucket: "kyodai-keio-joint-2026.firebasestorage.app",
  messagingSenderId: "44729432402",
  appId: "1:44729432402:web:f6fe7821d1b0b473f6228b",
  measurementId: "G-D6TBZKYLHR"
};

// みんなで共有する“部屋”（1サイト=1つでOK）
const ROOM_ID = "main"; // 例: "kyodai-keio-2026" に変えてもOK

// ===== local device id（退出/削除権限に使用）=====
const DEVICE_KEY = "joint_device_id_v1";
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function uid() {
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
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

// "YYYY-MM-DD" -> その日の 23:59（ローカル）のISO
function deadlineDateToISO(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const local = new Date(y, m - 1, d, 23, 59, 0, 0);
  return local.toISOString();
}

function isLocked(ev) {
  return Date.now() > new Date(ev.deadlineISO).getTime();
}

/* ===== 日程セレクト（2/18 13:00〜2/22 09:00、1時間刻み） ===== */
function buildTimeOptions() {
  const start = new Date("2026-02-18T13:00:00");
  const end = new Date("2026-02-22T09:00:00");
  const stepMin = 60;
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
    const opt = document.createElement("option");
    opt.value = iso;
    opt.textContent = formatJP(iso);
    sel.appendChild(opt);
  }
}

function fillTimeSelects(startSel, endSel) {
  fillSelectFromTimes(startSel);
  fillSelectFromTimes(endSel);

  startSel.selectedIndex = 0;
  endSel.selectedIndex = Math.min(2, endSel.options.length - 1);

  function ensure() {
    const s = new Date(startSel.value).getTime();
    const e = new Date(endSel.value).getTime();
    if (e <= s) {
      const opts = Array.from(endSel.options);
      const sIdx = opts.findIndex(o => o.value === startSel.value);
      endSel.selectedIndex = Math.min(sIdx + 2, endSel.options.length - 1);
    }
  }
  startSel.addEventListener("change", ensure);
  endSel.addEventListener("change", ensure);
}

function fillPeopleSelect(sel, maxN = 60) {
  for (let i = 1; i <= maxN; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
}

// ===== Firestore（compat）=====
let db = null;
let roomRef = null;

function initFirebase() {
  if (!window.firebase) {
    throw new Error("Firebase SDKが読み込まれていません。HTMLの<head>に compat のscriptを追加してください。");
  }
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  roomRef = db.collection("rooms").doc(ROOM_ID);
}

// 初回: roomドキュメントが無ければ作る
async function ensureRoomDoc() {
  const snap = await roomRef.get();
  if (!snap.exists) {
    await roomRef.set({ events: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

async function loadEventsRemote() {
  const snap = await roomRef.get();
  if (!snap.exists) return [];
  const data = snap.data() || {};
  return Array.isArray(data.events) ? data.events : [];
}

// 競合に強い保存（transaction）
async function updateEventsRemote(mutatorFn) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.exists ? (snap.data() || {}) : {};
    const events = Array.isArray(data.events) ? data.events : [];
    const nextEvents = mutatorFn(events);

    tx.set(roomRef, {
      events: nextEvents,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

// ===== events.html 表示 =====
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

    const peopleItems = (ev.participants || []).map(p => {
      const label = `${p.name}（${p.univ}・${p.grade}年・${p.part}）`;
      const canRemove = (!locked) && (p.deviceId === deviceId);
      if (canRemove) {
        return `<li><button class="name-btn" data-action="leave" data-event-id="${escapeHtml(ev.id)}" data-person-id="${escapeHtml(p.id)}" type="button">${escapeHtml(label)}</button></li>`;
      }
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    const canDelete = (ev.creatorDeviceId === deviceId);
    const deleteBtn = canDelete
      ? `<div class="card-actions"><button class="btn small danger-outline" data-action="delete-event" data-event-id="${escapeHtml(ev.id)}" type="button">このイベントを削除</button></div>`
      : "";

    container.insertAdjacentHTML("beforeend", `
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
          <p class="people-title">現在の参加者（${(ev.participants || []).length}名）</p>
          <ul class="people-list">${peopleItems || "<li>まだ参加者がいません</li>"}</ul>
          <p class="hint">※自分の名前（この端末で参加したもの）はタップで退出できます（締切前のみ）</p>
        </div>
        ${deleteBtn}
      </article>
    `);
  }
}

function initEventsPage(deviceId) {
  const list = document.getElementById("eventsList");
  const count = document.getElementById("eventCount");
  const empty = document.getElementById("emptyState");

  // リアルタイム購読：他端末の変更が即反映
  roomRef.onSnapshot((snap) => {
    const data = snap.data() || {};
    const events = Array.isArray(data.events) ? data.events : [];
    count.textContent = String(events.length);

    if (events.length === 0) {
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    empty.hidden = true;
    renderEventsList(list, events, deviceId);
  });

  // 退出/削除
  document.body.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    if (!action) return;

    if (action === "leave") {
      const eventId = t.getAttribute("data-event-id");
      const personId = t.getAttribute("data-person-id");
      if (!eventId || !personId) return;
      if (!confirm("このイベントから退出しますか？")) return;

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (isLocked(ev)) { alert("締め切り後のため退出できません。"); return events; }

        const p = (ev.participants || []).find(x => x.id === personId);
        if (!p) { alert("参加者が見つかりませんでした。"); return events; }
        if (p.deviceId !== deviceId) { alert("この端末から参加した本人のみ退出できます。"); return events; }

        ev.participants = (ev.participants || []).filter(x => x.id !== personId);
        alert("退出しました。");
        return events;
      });
    }

    if (action === "delete-event") {
      const eventId = t.getAttribute("data-event-id");
      if (!eventId) return;
      if (!confirm("このイベントを削除しますか？（参加者情報も消えます）")) return;

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (ev.creatorDeviceId !== deviceId) { alert("作成者（この端末）だけがイベントを削除できます。"); return events; }

        alert("イベントを削除しました。");
        return events.filter(x => x.id !== eventId);
      });
    }
  });
}

// ===== join.html 表示 =====
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
    const statusBadge = locked ? `<span class="badge locked">締切済み</span>` : `<span class="badge">募集中</span>`;

    const participantsHtml = (ev.participants || []).map(p => {
      const label = `${p.name}（${p.univ}・${p.grade}年・${p.part}）`;
      const canRemove = (!locked) && (p.deviceId === deviceId);
      if (canRemove) {
        return `<li><button class="name-btn" data-action="leave" data-event-id="${escapeHtml(ev.id)}" data-person-id="${escapeHtml(p.id)}" type="button">${escapeHtml(label)}</button></li>`;
      }
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    const atCap = (typeof ev.maxPeople === "number") && ((ev.participants || []).length >= ev.maxPeople);
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
          <p class="people-title">現在の参加者（${(ev.participants || []).length}名）</p>
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

  container.querySelectorAll(".acc-item").forEach(item => {
    const head = item.querySelector(".acc-head");
    head.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
}

function initJoinPage(deviceId) {
  const list = document.getElementById("joinList");
  const empty = document.getElementById("emptyJoin");

  // リアルタイム購読
  roomRef.onSnapshot((snap) => {
    const data = snap.data() || {};
    const events = Array.isArray(data.events) ? data.events : [];

    if (events.length === 0) {
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    empty.hidden = true;
    renderJoinList(list, events, deviceId);
  });

  // 退出/削除/参加
  list.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    if (!action) return;

    if (action === "leave") {
      const eventId = t.getAttribute("data-event-id");
      const personId = t.getAttribute("data-person-id");
      if (!eventId || !personId) return;
      if (!confirm("このイベントから退出しますか？")) return;

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (isLocked(ev)) { alert("締め切り後のため退出できません。"); return events; }

        const p = (ev.participants || []).find(x => x.id === personId);
        if (!p) { alert("参加者が見つかりませんでした。"); return events; }
        if (p.deviceId !== deviceId) { alert("この端末から参加した本人のみ退出できます。"); return events; }

        ev.participants = (ev.participants || []).filter(x => x.id !== personId);
        alert("退出しました。");
        return events;
      });
    }

    if (action === "delete-event") {
      const eventId = t.getAttribute("data-event-id");
      if (!eventId) return;
      if (!confirm("このイベントを削除しますか？（参加者情報も消えます）")) return;

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (ev.creatorDeviceId !== deviceId) { alert("作成者（この端末）だけがイベントを削除できます。"); return events; }

        alert("イベントを削除しました。");
        return events.filter(x => x.id !== eventId);
      });
    }
  });

  // 参加フォーム submit（イベント委任）
  list.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.classList.contains("join-form")) return;

    e.preventDefault();
    const msg = form.querySelector(".msg");
    if (msg) msg.textContent = "";

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
      if (msg) msg.textContent = "未入力の項目があります。すべて入力してください。";
      return;
    }

    await updateEventsRemote((events) => {
      const ev = events.find(x => x.id === evId);
      if (!ev) { if (msg) msg.textContent = "イベントが見つかりませんでした。"; return events; }
      if (isLocked(ev)) { if (msg) msg.textContent = "締め切り後のため参加できません。"; return events; }

      ev.participants = ev.participants || [];

      const dup = ev.participants.some(p =>
        p.name === person.name && p.univ === person.univ && p.grade === person.grade && p.part === person.part
      );
      if (dup) { if (msg) msg.textContent = "すでに同じ情報で参加済みです。"; return events; }

      if (typeof ev.maxPeople === "number" && ev.participants.length >= ev.maxPeople) {
        if (msg) msg.textContent = "募集人数に達しています。";
        return events;
      }

      ev.participants.push(person);
      if (msg) msg.textContent = "参加しました！";
      return events;
    });

    form.reset();
  });
}

// ===== create.html =====
function initCreatePage(deviceId) {
  const form = document.getElementById("createForm");
  const msg = document.getElementById("formMsg");

  const detail = document.getElementById("detail");
  const detailCount = document.getElementById("detailCount");

  const startSel = document.getElementById("startTime");
  const endSel = document.getElementById("endTime");
  fillTimeSelects(startSel, endSel);

  const deadlineDateEl = document.getElementById("deadlineDate");
  if (deadlineDateEl && !deadlineDateEl.value) deadlineDateEl.value = "2026-02-22";

  const minSel = document.getElementById("minPeople");
  const maxSel = document.getElementById("maxPeople");
  fillPeopleSelect(minSel, 60);
  fillPeopleSelect(maxSel, 60);

  if (detail && detailCount) {
    detail.addEventListener("input", () => {
      detailCount.textContent = String(detail.value.length);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    try {
      const fd = new FormData(form);

      const title = String(fd.get("title") || "").trim();
      const detailText = String(fd.get("detail") || "").trim();
      const startISO = String(fd.get("startTime") || "");
      const endISO = String(fd.get("endTime") || "");

      const deadlineDate = String(fd.get("deadlineDate") || "");
      if (!deadlineDate) { msg.textContent = "締め切り日付を選択してください。"; return; }
      if (deadlineDate < "2026-01-01" || deadlineDate > "2026-02-22") {
        msg.textContent = "締め切りは 2026/1/1〜2026/2/22 の範囲で選択してください。";
        return;
      }
      const deadlineISO = deadlineDateToISO(deadlineDate);

      const minRaw = String(fd.get("minPeople") || "").trim();
      const maxRaw = String(fd.get("maxPeople") || "").trim();
      const minPeople = minRaw ? Number(minRaw) : null;
      const maxPeople = maxRaw ? Number(maxRaw) : null;

      const creator = {
        id: uid(),
        name: String(fd.get("name") || "").trim(),
        univ: fd.get("univ"),
        grade: fd.get("grade"),
        part: fd.get("part"),
        deviceId,
      };

      if (!title || !startISO || !endISO || !creator.name || !creator.univ || !creator.grade || !creator.part) {
        msg.textContent = "未入力の必須項目があります。すべて入力してください。";
        return;
      }
      if (detailText.length > 100) { msg.textContent = "詳細は100文字以内にしてください。"; return; }

      const s = new Date(startISO).getTime();
      const en = new Date(endISO).getTime();
      if (!(en > s)) { msg.textContent = "日程の終了は開始より後にしてください。"; return; }

      if (minPeople !== null && (!Number.isFinite(minPeople) || minPeople < 1)) { msg.textContent = "募集人数（最小）が不正です。"; return; }
      if (maxPeople !== null && (!Number.isFinite(maxPeople) || maxPeople < 1)) { msg.textContent = "募集人数（最大）が不正です。"; return; }
      if (minPeople !== null && maxPeople !== null && minPeople > maxPeople) { msg.textContent = "募集人数は「最小 ≤ 最大」にしてください。"; return; }

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
        participants: [creator],
        createdAtISO: new Date().toISOString(),
      };

      await updateEventsRemote((events) => {
        events.push(ev);
        return events;
      });

      msg.textContent = "作成しました！募集中イベント一覧に移動します。";
      setTimeout(() => { window.location.href = "events.html"; }, 200);
    } catch (err) {
      console.error(err);
      msg.textContent = "保存に失敗しました。Firestoreルール/SDK読み込み/Consoleエラーを確認してください。";
    }
  });
}

/* ===== boot ===== */
document.addEventListener("DOMContentLoaded", async () => {
  const deviceId = getDeviceId();
  const page = document.body?.dataset?.page;

  try {
    initFirebase();
    await ensureRoomDoc();
  } catch (e) {
    console.error(e);
    // 画面に出せる場合はメッセージ表示
    const el = document.getElementById("formMsg") || document.getElementById("emptyState") || document.getElementById("emptyJoin");
    if (el) el.textContent = "Firebaseの読み込みに失敗しました。HTMLの<head>にFirebase scriptを追加してください。";
    return;
  }

  if (page === "create") initCreatePage(deviceId);
  if (page === "home2") initEventsPage(deviceId);
  if (page === "join") initJoinPage(deviceId);
});
