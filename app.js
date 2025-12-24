/* =========================
   京大×慶應 交流マッチング
   - localStorage 永続化
   ========================= */

const STORAGE_KEY = "joint_events_v1";

/** @typedef {{name:string, univ:"京大"|"慶應", grade:"1"|"2"|"3"|"4"|"5+", part:string}} Person */
/** @typedef {{id:string, title:string, detail:string, startISO:string, endISO:string, minPeople:number|null, maxPeople:number|null, creator:Person, participants:Person[], createdAtISO:string}} Event */

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
  // 表示：2/18 13:00 のような形
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${hh}:${mm}`;
}

/* ===== 日程セレクト（2/18 13:00〜2/22 09:00、1時間刻み） =====
   ※要望が曖昧だったので、範囲内で開始/終了を選べる仕様にしています。
*/
function buildTimeOptions() {
  // 年は固定しない（表示用）
  // ここでは 2026年の2月として扱う（交流の年）
  const start = new Date("2026-02-18T13:00:00");
  const end = new Date("2026-02-22T09:00:00");
  const stepMin = 60; // 1時間刻み

  const opts = [];
  let cur = new Date(start);
  while (cur <= end) {
    opts.push(new Date(cur));
    cur = new Date(cur.getTime() + stepMin * 60 * 1000);
  }
  return opts;
}

function fillTimeSelects(startSel, endSel) {
  const options = buildTimeOptions();
  startSel.innerHTML = "";
  endSel.innerHTML = "";

  for (const d of options) {
    const iso = d.toISOString();
    const label = formatJP(iso);
    const o1 = document.createElement("option");
    o1.value = iso;
    o1.textContent = label;
    startSel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = iso;
    o2.textContent = label;
    endSel.appendChild(o2);
  }

  // 初期値：開始=最初、終了=その2時間後（なければ最後）
  startSel.selectedIndex = 0;
  const idx2 = Math.min(2, endSel.options.length - 1);
  endSel.selectedIndex = idx2;
}

function fillPeopleSelect(sel, maxN = 60) {
  // 先頭「未設定」はHTML側で入れてある前提
  for (let i = 1; i <= maxN; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
}

/* ===== 描画：イベントカード（events.html） ===== */
function renderEventsList(container, events) {
  container.innerHTML = "";
  const sorted = [...events].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  for (const ev of sorted) {
    const range = `${formatJP(ev.startISO)} 〜 ${formatJP(ev.endISO)}`;
    const cap =
      (ev.minPeople || ev.maxPeople)
        ? `募集：${ev.minPeople ?? "?"}〜${ev.maxPeople ?? "?"}人`
        : "募集：未設定";

    const peopleItems = ev.participants
      .map(p => `<li>${escapeHtml(p.name)}（${escapeHtml(p.univ)}・${escapeHtml(p.grade)}年・${escapeHtml(p.part)}）</li>`)
      .join("");

    const creator = `${ev.creator.name}（${ev.creator.univ}・${ev.creator.grade}年・${ev.creator.part}）`;

    const html = `
      <article class="card">
        <div class="card-head">
          <h3 class="card-title">${escapeHtml(ev.title)}</h3>
          <span class="badge">${escapeHtml(ev.creator.univ)}発</span>
        </div>
        <div class="card-meta">
          <div>日程：<strong>${escapeHtml(range)}</strong></div>
          <div>${escapeHtml(cap)}</div>
          <div>作成者：${escapeHtml(creator)}</div>
        </div>
        <p class="card-detail">${escapeHtml(ev.detail || "（詳細なし）")}</p>

        <div class="people">
          <p class="people-title">現在の参加者（${ev.participants.length}名）</p>
          <ul class="people-list">${peopleItems || "<li>まだ参加者がいません</li>"}</ul>
        </div>
      </article>
    `;
    container.insertAdjacentHTML("beforeend", html);
  }
}

/* ===== 参加ページ：アコーディオン ===== */
function renderJoinList(container, events) {
  container.innerHTML = "";
  const sorted = [...events].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  for (const ev of sorted) {
    const range = `${formatJP(ev.startISO)} 〜 ${formatJP(ev.endISO)}`;
    const cap =
      (ev.minPeople || ev.maxPeople)
        ? `募集：${ev.minPeople ?? "?"}〜${ev.maxPeople ?? "?"}人`
        : "募集：未設定";

    const participantsHtml = ev.participants
      .map(p => `<li>${escapeHtml(p.name)}（${escapeHtml(p.univ)}・${escapeHtml(p.grade)}年・${escapeHtml(p.part)}）</li>`)
      .join("");

    const item = document.createElement("div");
    item.className = "acc-item";
    item.innerHTML = `
      <button class="acc-head" type="button" aria-expanded="false">
        <div>
          <strong>${escapeHtml(ev.title)}</strong><br/>
          <span class="meta">日程：${escapeHtml(range)} ／ ${escapeHtml(cap)}</span>
        </div>
        <span class="badge">${escapeHtml(ev.participants.length)}名</span>
      </button>

      <div class="acc-body">
        <p class="card-detail">${escapeHtml(ev.detail || "（詳細なし）")}</p>

        <div class="people">
          <p class="people-title">現在の参加者</p>
          <ul class="people-list">${participantsHtml || "<li>まだ参加者がいません</li>"}</ul>
        </div>

        <form class="join-form" data-event-id="${escapeHtml(ev.id)}" novalidate>
          <div class="grid2">
            <div class="field">
              <label>名前</label>
              <input name="name" type="text" required maxlength="30" placeholder="例：山田 太郎" />
            </div>
            <div class="field">
              <label>大学名（京大/慶應）</label>
              <select name="univ" required>
                <option value="">選択してください</option>
                <option value="京大">京大</option>
                <option value="慶應">慶應</option>
              </select>
            </div>
          </div>

          <div class="grid2">
            <div class="field">
              <label>学年</label>
              <select name="grade" required>
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
              <select name="part" required>
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
            <button class="btn square red" type="submit">参加する</button>
          </div>

          <div class="msg" aria-live="polite"></div>
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

  // join submit
  container.querySelectorAll(".join-form").forEach(form => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = form.querySelector(".msg");
      msg.textContent = "";

      const evId = form.getAttribute("data-event-id");
      const fd = new FormData(form);
      const person = {
        name: String(fd.get("name") || "").trim(),
        univ: fd.get("univ"),
        grade: fd.get("grade"),
        part: fd.get("part"),
      };

      // validate
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

      // duplicate check（同名+大学+学年+パートが同一なら重複扱い）
      const dup = ev.participants.some(p =>
        p.name === person.name && p.univ === person.univ && p.grade === person.grade && p.part === person.part
      );
      if (dup) {
        msg.textContent = "すでに同じ情報で参加済みです。";
        return;
      }

      // capacity check (if maxPeople set)
      if (typeof ev.maxPeople === "number" && ev.participants.length >= ev.maxPeople) {
        msg.textContent = "募集人数に達しています。別の企画をご検討ください。";
        return;
      }

      ev.participants.push(person);
      saveEvents(events);

      msg.textContent = "参加しました！募集中のイベント一覧にも反映されます。";
      form.reset();

      // refresh view
      renderJoinList(container, loadEvents());
    });
  });
}

/* ===== create page handling ===== */
function initCreatePage() {
  const form = document.getElementById("createForm");
  const msg = document.getElementById("formMsg");
  const detail = document.getElementById("detail");
  const detailCount = document.getElementById("detailCount");

  const startSel = document.getElementById("startTime");
  const endSel = document.getElementById("endTime");
  fillTimeSelects(startSel, endSel);

  const minSel = document.getElementById("minPeople");
  const maxSel = document.getElementById("maxPeople");
  fillPeopleSelect(minSel, 60);
  fillPeopleSelect(maxSel, 60);

  detail.addEventListener("input", () => {
    detailCount.textContent = String(detail.value.length);
  });

  function ensureEndAfterStart() {
    const s = new Date(startSel.value).getTime();
    const e = new Date(endSel.value).getTime();
    if (e <= s) {
      // 終了を開始+2時間に寄せる（なければ最後）
      const options = Array.from(endSel.options);
      const sIdx = options.findIndex(o => o.value === startSel.value);
      endSel.selectedIndex = Math.min(sIdx + 2, endSel.options.length - 1);
    }
  }

  startSel.addEventListener("change", ensureEndAfterStart);
  endSel.addEventListener("change", ensureEndAfterStart);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    msg.textContent = "";

    const fd = new FormData(form);

    const title = String(fd.get("title") || "").trim();
    const detailText = String(fd.get("detail") || "").trim();
    const startISO = String(fd.get("startTime") || "");
    const endISO = String(fd.get("endTime") || "");

    const minRaw = String(fd.get("minPeople") || "").trim();
    const maxRaw = String(fd.get("maxPeople") || "").trim();
    const minPeople = minRaw ? Number(minRaw) : null;
    const maxPeople = maxRaw ? Number(maxRaw) : null;

    /** @type {Person} */
    const creator = {
      name: String(fd.get("name") || "").trim(),
      univ: fd.get("univ"),
      grade: fd.get("grade"),
      part: fd.get("part"),
    };

    // validate required
    if (!title || !startISO || !endISO || !creator.name || !creator.univ || !creator.grade || !creator.part) {
      msg.textContent = "未入力の必須項目があります。すべて入力してください。";
      return;
    }

    // detail length
    if (detailText.length > 100) {
      msg.textContent = "詳細は100文字以内にしてください。";
      return;
    }

    // time validate
    const s = new Date(startISO).getTime();
    const en = new Date(endISO).getTime();
    if (!(en > s)) {
      msg.textContent = "日程の終了は開始より後にしてください。";
      return;
    }

    // people validate
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
      minPeople,
      maxPeople,
      creator,
      // 作成者を参加者に自動追加
      participants: [creator],
      createdAtISO: new Date().toISOString(),
    };

    const events = loadEvents();
    events.push(ev);
    saveEvents(events);

    msg.textContent = "作成しました！募集中のイベント一覧に移動します。";

    // redirect
    setTimeout(() => {
      window.location.href = "events.html";
    }, 350);
  });
}

/* ===== events page handling ===== */
function initEventsPage() {
  const list = document.getElementById("eventsList");
  const count = document.getElementById("eventCount");
  const empty = document.getElementById("emptyState");
  const seedBtn = document.getElementById("seedBtn");
  const clearBtn = document.getElementById("clearBtn");

  function refresh() {
    const events = loadEvents();
    count.textContent = String(events.length);
    if (events.length === 0) {
      empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    empty.hidden = true;
    renderEventsList(list, events);
  }

  seedBtn?.addEventListener("click", () => {
    const events = loadEvents();
    const demo = {
      id: uid(),
      title: "デモ：木管アンサンブル会",
      detail: "初対面でもOK！パート混成で小曲を合わせよう。",
      startISO: new Date("2026-02-19T13:00:00").toISOString(),
      endISO: new Date("2026-02-19T15:00:00").toISOString(),
      minPeople: 3,
      maxPeople: 10,
      creator: { name: "デモ作成者", univ: "京大", grade: "3", part: "Cl" },
      participants: [
        { name: "デモ作成者", univ: "京大", grade: "3", part: "Cl" },
        { name: "サンプル参加", univ: "慶應", grade: "2", part: "Fl" },
      ],
      createdAtISO: new Date().toISOString(),
    };
    events.push(demo);
    saveEvents(events);
    refresh();
  });

  clearBtn?.addEventListener("click", () => {
    if (!confirm("本当に全データを削除しますか？（このブラウザ内の保存データが消えます）")) return;
    localStorage.removeItem(STORAGE_KEY);
    refresh();
  });

  refresh();
}

/* ===== join page handling ===== */
function initJoinPage() {
  const list = document.getElementById("joinList");
  const empty = document.getElementById("emptyJoin");
  const events = loadEvents();
  if (events.length === 0) {
    empty.hidden = false;
    list.innerHTML = "";
    return;
  }
  empty.hidden = true;
  renderJoinList(list, events);
}

/* ===== boot ===== */
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body?.dataset?.page;

  if (page === "create") initCreatePage();
  if (page === "home2") initEventsPage();
  if (page === "join") initJoinPage();
});