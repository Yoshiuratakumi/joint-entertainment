/* =========================
   京大×慶應 交流マッチング（Firestore同期 + 画像URL/アップロード両対応版）
   - イベント作成/参加/退出/削除
   - 締め切り後は参加/退出ロック
   - 別端末でも同じ一覧に即時反映（onSnapshot）
   - 画像（任意）：
       (A) 画像URL（http/httpsならOK。拡張子なしの共有リンクも可）
       (B) ファイル（JPEG/PNG 10MBまで）→ Storageに保存（Storageが有効な場合）
   ========================= */

// ===== Firebase config（あなたの値）=====
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBMdc9G-4QxkWr99o0yy29Xu5F-XCWP4U",
  authDomain: "kyodai-keio-joint-2026.firebaseapp.com",
  projectId: "kyodai-keio-joint-2026",
  storageBucket: "kyodai-keio-joint-2026.appspot.com",
  messagingSenderId: "44729432402",
  appId: "1:44729432402:web:f6fe7821d1b0b473f6228b",
  measurementId: "G-D6TBZKYLHR"
};

// みんなで共有する“部屋”（1サイト=1つでOK）
const ROOM_ID = "main";

// 1端末あたり作成できるイベント上限
const MAX_EVENTS_PER_DEVICE = 5;

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

/* ===== 画像：URL / ファイル 共通バリデーション ===== */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB

function validateImageFile(file) {
  if (!file) return { ok: true, reason: "" };
  const okType = (file.type === "image/jpeg" || file.type === "image/png");
  if (!okType) return { ok: false, reason: "画像ファイルは JPEG または PNG のみ対応です。" };
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, reason: "画像ファイルは 10MB 以内にしてください。" };
  return { ok: true, reason: "" };
}

// ✅URLは「http/https ならOK（拡張子チェックしない）」
function validateImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return { ok: true, reason: "" };
  if (u.length > 2000) return { ok: false, reason: "画像URLが長すぎます（2000文字以内にしてください）。" };
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: "画像URLは http または https で始まるURLにしてください。" };
  // 念のため危険なスキーム拒否
  if (/^javascript:/i.test(u)) return { ok: false, reason: "そのURL形式は使用できません。" };
  return { ok: true, reason: "" };
}

function normalizeUrl(url) {
  return String(url || "").trim();
}

/* ===== Firestore / Storage（compat） ===== */
let db = null;
let roomRef = null;
let storage = null;

function initFirebase() {
  if (!window.firebase) {
    throw new Error("Firebase SDKが読み込まれていません。HTMLの<head>に compat のscriptを追加してください。");
  }
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();

  // Storage SDK を読み込んでいない場合もあるので安全に
  if (firebase.storage) {
    try { storage = firebase.storage(); } catch (_) { storage = null; }
  }
  roomRef = db.collection("rooms").doc(ROOM_ID);
}

function imageRefForEvent(eventId) {
  if (!storage) return null;
  return storage.ref().child(`rooms/${ROOM_ID}/events/${eventId}/image`);
}

// 初回: roomドキュメントが無ければ作る
async function ensureRoomDoc() {
  const snap = await roomRef.get();
  if (!snap.exists) {
    await roomRef.set({ events: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
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

// いまのイベント一覧を1回だけ取得（削除時に画像URLを取る用途）
async function getEventsOnce() {
  const snap = await roomRef.get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return Array.isArray(data.events) ? data.events : [];
}

/* ===== 画像表示：読み込み失敗したらリンクに切り替える ===== */
function renderEventImageBlock(imageUrl) {
  if (!imageUrl) return "";
  const u = escapeHtml(imageUrl);
  // onerror で画像を非表示にしてリンクを表示
  return `
    <div class="event-image-wrap">
      <img class="event-image" src="${u}" alt="イベント画像" loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.hidden=false;">
      <a class="btn ghost small" href="${u}" target="_blank" rel="noopener"
        hidden>画像を開く</a>
    </div>
  `;
}

/* ===== events.html 表示 ===== */
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

    const imageTop = renderEventImageBlock(ev.imageUrl);

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
        ${imageTop}
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

      const beforeEvents = await getEventsOnce();
      const target = beforeEvents.find(x => x.id === eventId);
      const hadImage = !!(target && target.imageUrl);

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (ev.creatorDeviceId !== deviceId) { alert("作成者（この端末）だけがイベントを削除できます。"); return events; }

        alert("イベントを削除しました。");
        return events.filter(x => x.id !== eventId);
      });

      // Storage画像を消せるのは storage が使える場合だけ
      if (hadImage && storage) {
        try {
          const ref = imageRefForEvent(eventId);
          if (ref) await ref.delete();
        } catch (err) {
          console.warn("画像の削除に失敗しました（無視して続行）:", err);
        }
      }
    }
  });
}

/* ===== join.html 表示 ===== */
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

    const imageTop = ev.imageUrl
      ? `<img class="event-image" src="${escapeHtml(ev.imageUrl)}" alt="イベント画像" loading="lazy">`
      : "";

    const participantsHtml = (ev.participants || []).map(p => {
      const label = `${p.name}（${p.univ}・${p.grade}年・${p.part}）`;
      const canRemove = (!locked) && (p.deviceId === deviceId);
      if (canRemove) {
        return `<li><button class="name-btn" data-action="leave" data-event-id="${escapeHtml(ev.id)}" data-person-id="${escapeHtml(p.id)}" type="button">${escapeHtml(label)}</button></li>`;
      }
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    // ★追加：この端末がすでに参加済みか？
    const alreadyJoinedByThisDevice = (ev.participants || []).some(p => p.deviceId === deviceId);

    const atCap = (typeof ev.maxPeople === "number") && ((ev.participants || []).length >= ev.maxPeople);

    // ★変更：参加済み端末なら joinDisabled
    const joinDisabled = locked || atCap || alreadyJoinedByThisDevice;

    const reason =
      locked ? "締切済みのため参加できません。"
      : atCap ? "募集人数に達しています。"
      : alreadyJoinedByThisDevice ? "この端末はすでに参加済みです（1イベントにつき1回まで）。"
      : "";

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
        ${imageTop}
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

      const beforeEvents = await getEventsOnce();
      const target = beforeEvents.find(x => x.id === eventId);
      const hadImage = !!(target && target.imageUrl);

      await updateEventsRemote((events) => {
        const ev = events.find(x => x.id === eventId);
        if (!ev) { alert("イベントが見つかりませんでした。"); return events; }
        if (ev.creatorDeviceId !== deviceId) { alert("作成者（この端末）だけがイベントを削除できます。"); return events; }

        alert("イベントを削除しました。");
        return events.filter(x => x.id !== eventId);
      });

      if (hadImage && storage) {
        try {
          const ref = imageRefForEvent(eventId);
          if (ref) await ref.delete();
        } catch (err) {
          console.warn("画像の削除に失敗しました（無視して続行）:", err);
        }
      }
    }
  });

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

  // ★追加：同じ端末は1イベントに1回まで
  const already = ev.participants.some(p => p.deviceId === deviceId);
  if (already) {
    if (msg) msg.textContent = "この端末はすでに参加済みです（1イベントにつき1回まで）。";
    return events;
  }

  // 既存の「同じ情報で参加済み」チェック（あってもOK）
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

/* ===== create.html ===== */
function initCreatePage(deviceId) {
  const form = document.getElementById("createForm");
  const msg = document.getElementById("formMsg");

// ★作成数上限チェック（UI側）
  const submitBtn = form.querySelector('button[type="submit"]');

  (async () => {
    try {
      const eventsNow = await getEventsOnce();
      const createdCount = eventsNow.filter(ev => ev.creatorDeviceId === deviceId).length;

      if (createdCount >= MAX_EVENTS_PER_DEVICE) {
        if (submitBtn) submitBtn.disabled = true;
        msg.textContent = `この端末から作成できるイベントは${MAX_EVENTS_PER_DEVICE}件までです。（現在：${createdCount}件）`;
      }
    } catch (e) {
      // 取得に失敗してもフォームは使えるようにしておく
      console.warn("作成数チェックに失敗:", e);
    }
  })();


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

  // 画像 URL / File / preview
  const urlInput = document.getElementById("eventImageUrl");
  const fileInput = document.getElementById("eventImage");
  const previewWrap = document.getElementById("imagePreviewWrap");
  const previewImg = document.getElementById("imagePreview");
  const previewHint = document.getElementById("imagePreviewHint");

  function showPreview(src, hint) {
    if (!previewWrap || !previewImg) return;
    previewImg.src = src || "";
    previewWrap.hidden = !src;
    if (previewHint) {
      previewHint.hidden = !hint;
    }
  }

  // URL入力→プレビュー（失敗するURLもあるので、onerror ではヒントを出すだけ）
  if (urlInput) {
    urlInput.addEventListener("input", () => {
      const u = normalizeUrl(urlInput.value);
      const v = validateImageUrl(u);
      if (!u) {
        showPreview("", false);
        return;
      }
      if (!v.ok) {
        showPreview("", false);
        return;
      }
      showPreview(u, true);
    });
  }

  // ファイル選択→プレビュー
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0] || null;
      if (!f) {
        // URLが入っているならURLプレビュー維持
        const u = normalizeUrl(urlInput?.value || "");
        if (u && validateImageUrl(u).ok) showPreview(u, true);
        else showPreview("", false);
        return;
      }
      const v = validateImageFile(f);
      if (!v.ok) {
        alert(v.reason);
        fileInput.value = "";
        return;
      }
      // ファイルが選ばれたらURLは空にしてOK（混乱防止）
      if (urlInput) urlInput.value = "";
      showPreview(URL.createObjectURL(f), false);
    });
  }

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

      // イベントIDを先に確定（画像パスに使う）
      const eventId = uid();

      // 画像URL（任意）
      const rawUrl = normalizeUrl(urlInput?.value || "");
      const urlV = validateImageUrl(rawUrl);
      if (!urlV.ok) { msg.textContent = urlV.reason; return; }

      // 画像ファイル（任意）
      const file = fileInput?.files?.[0] || null;
      const fileV = validateImageFile(file);
      if (!fileV.ok) { msg.textContent = fileV.reason; return; }

      // 優先順位：ファイル > URL
      let imageUrl = rawUrl ? rawUrl : null;

      // ファイルがある場合、Storageにアップロード（Storageが使えるときだけ）
      if (file) {
        if (!storage) {
          msg.textContent = "この環境ではStorageが使えないため、画像ファイルのアップロードはできません。画像URLを貼り付けてください。";
          return;
        }

        const ref = imageRefForEvent(eventId);
        if (!ref) {
          msg.textContent = "Storage参照の作成に失敗しました。画像URLを貼り付けてください。";
          return;
        }

        msg.textContent = "画像をアップロード中…（0%）";
        const uploadTask = ref.put(file, { contentType: file.type });

        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const pct = snapshot.totalBytes
                ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                : 0;
              msg.textContent = `画像をアップロード中…（${pct}%）`;
            },
            (err) => reject(err),
            () => resolve()
          );
        });

        imageUrl = await ref.getDownloadURL();
      }

      const ev = {
        id: eventId,
        title,
        detail: detailText,
        startISO,
        endISO,
        deadlineISO,
        minPeople,
        maxPeople,
        imageUrl, // ★URL or Storage downloadURL
        creator,
        creatorDeviceId: deviceId,
        participants: [creator],
        createdAtISO: new Date().toISOString(),
      };

      msg.textContent = "保存中…";

      await updateEventsRemote((events) => {
        const createdCount = events.filter(x => x.creatorDeviceId === deviceId).length;
        if (createdCount >= MAX_EVENTS_PER_DEVICE) {
          // transaction を中断させる
          throw new Error(`CREATE_LIMIT_REACHED:${createdCount}`);
        }
        events.push(ev);
        return events;
      });

      msg.textContent = "作成しました！募集中イベント一覧に移動します。";
      setTimeout(() => { window.location.href = "events.html"; }, 200);

    } catch (err) {
      console.error(err);

      // ★上限で弾かれたのに画像だけ上がってしまった場合は削除
      try {
        const isLimit = String(err?.message || "").startsWith("CREATE_LIMIT_REACHED");
        if (isLimit) {
          // eventId は submit 内で作っている前提（あなたのコードの eventId 変数）
          await imageRefForEvent(eventId).delete().catch(() => {});
          msg.textContent = `この端末から作成できるイベントは${MAX_EVENTS_PER_DEVICE}件までです。`;
          return;
        }
      } catch (_) {}

      const code = err?.code ? `（${err.code}）` : "";
      const message = err?.message ? err.message : "不明なエラー";
      msg.textContent = `保存に失敗しました${code}：${message}`;
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
    const el = document.getElementById("formMsg")
      || document.getElementById("emptyState")
      || document.getElementById("emptyJoin");
    if (el) el.textContent = "Firebaseの読み込みに失敗しました。HTMLの<head>にFirebase scriptを追加してください。";
    return;
  }

  if (page === "create") initCreatePage(deviceId);
  if (page === "home2") initEventsPage(deviceId);
  if (page === "join") initJoinPage(deviceId);
});


