// ==UserScript==
// @name         Котонаходиловка
// @namespace    kotonahodilovka
// @version      1.0
// @description  Подсвечивает котов на текущей локации CatWar по имени или ID.
// @author       Жаровей (1080554)
// @match        *://catwar.net/cw3*
// @match        *://*.catwar.net/cw3*
// @match        *://catwar.su/cw3*
// @match        *://*.catwar.su/cw3*
// @updateURL    https://raw.githubusercontent.com/cat-be/kotonahodilovka/main/CatWar-Cat-Finder.user.js
// @downloadURL  https://raw.githubusercontent.com/cat-be/kotonahodilovka/main/CatWar-Cat-Finder.user.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "cwCatFinderSettings";
  const HIGHLIGHT_CLASS = "cwcf-highlight";
  const CAT_CLASS = "cwcf-cat-highlight";
  const BADGE_CLASS = "cwcf-badge";
  const PANEL_ID = "cwcf-panel";
  const WINDOW_ID = "cwcf-window";

  const defaultSettings = {
    enabled: true,
    queryItems: [],
    color: "#ffd54a",
    matchMode: "exact",
    windowPosition: { left: 24, top: 90 },
    collapsed: false
  };

  let settings = loadSettings();
  let observer = null;
  let scanTimer = null;
  let saveTimer = null;
  let colorOutsideClickBound = false;

  const style = document.createElement("style");
  style.id = "cwcf-style";
  document.documentElement.appendChild(style);

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("ru-RU");
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return migrateSettings(raw);
    } catch (_error) {
      return migrateSettings({});
    }
  }

  function migrateSettings(raw) {
    const next = { ...defaultSettings, ...(raw || {}) };

    if (!Array.isArray(next.queryItems) || !next.queryItems.length) {
      next.queryItems = (next.queries || [])
        .map((value) => String(value).trim())
        .filter(Boolean)
        .map((value) => ({ value, enabled: true }));
    }

    next.queryItems = next.queryItems
      .map((item) => {
        if (typeof item === "string") {
          return { value: item.trim(), enabled: true };
        }

        return {
          value: String(item?.value || "").trim(),
          enabled: item?.enabled !== false
        };
      })
      .filter((item) => item.value);

    next.windowPosition = {
      left: Number.isFinite(+next.windowPosition?.left) ? +next.windowPosition.left : defaultSettings.windowPosition.left,
      top: Number.isFinite(+next.windowPosition?.top) ? +next.windowPosition.top : defaultSettings.windowPosition.top
    };

    return next;
  }

  function saveSettings(quiet = false) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      if (!quiet) flashSaved();
    }, 120);
  }

  function getCatId(link) {
    const href = link?.getAttribute("href") || "";
    const match = href.match(/cat(\d+)/);
    return match ? match[1] : "";
  }

  function getActiveQueries() {
    return settings.queryItems
      .filter((item) => item.enabled)
      .map((item) => ({ raw: item.value, normalized: normalize(item.value) }));
  }

  function isMatch(cat, queries) {
    if (!queries.length) return false;

    const name = normalize(cat.name);
    const id = normalize(cat.id);

    return queries.some((query) => {
      if (query.normalized === id) return true;
      if (settings.matchMode === "contains") {
        return name.includes(query.normalized);
      }
      return name === query.normalized;
    });
  }

  function getCellCoords(td) {
    const row = td.parentElement ? Array.from(td.parentElement.parentElement.children).indexOf(td.parentElement) + 1 : 0;
    const column = Array.from(td.parentElement.children).indexOf(td) + 1;
    return { row, column };
  }

  function getCurrentLocation() {
    const candidates = [
      "#tr_loc",
      "#loc"
    ];

    for (const selector of candidates) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.replace(/\s+/g, " ").trim();
      if (text && text.length <= 80 && text !== "[ Загружается... ]" && text !== "[ Загружается… ]") {
        return text;
      }
    }

    return "";
  }

  function injectStyle() {
    const color = settings.color || defaultSettings.color;
    style.textContent = `
      #cages td.${HIGHLIGHT_CLASS} {
        position: relative !important;
        outline: 3px solid ${color} !important;
        outline-offset: -3px !important;
        box-shadow: inset 0 0 0 9999px color-mix(in srgb, ${color} 24%, transparent), 0 0 14px ${color} !important;
      }

      #cages td.${HIGHLIGHT_CLASS}:hover {
        z-index: 2147483000 !important;
      }

      #cages td.${HIGHLIGHT_CLASS}::after {
        content: "";
        position: absolute;
        inset: 2px;
        border: 2px dashed ${color};
        pointer-events: none;
        z-index: 1;
        animation: cwcf-pulse 1.2s ease-in-out infinite;
      }

      #cages td.${HIGHLIGHT_CLASS} .catWithArrow,
      #cages td.${HIGHLIGHT_CLASS} .cat {
        position: relative !important;
        z-index: 2 !important;
      }

      #cages td.${HIGHLIGHT_CLASS}:hover .cat_tooltip {
        z-index: 2147483647 !important;
      }

      #cages .cat.${CAT_CLASS} {
        filter: drop-shadow(0 0 3px ${color}) drop-shadow(0 0 8px ${color}) !important;
      }

      .${BADGE_CLASS} {
        position: absolute;
        z-index: 30;
        top: 2px;
        left: 2px;
        max-width: calc(100% - 4px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 1px 4px;
        border-radius: 4px;
        background: rgba(0, 0, 0, .72);
        color: ${color};
        font: 700 10px/1.3 Verdana, Arial, sans-serif;
        pointer-events: none;
      }

      #${PANEL_ID} {
        margin-top: 8px;
        color: #f6f6f6;
        font: 12px/1.45 Verdana, Arial, sans-serif;
      }

      #${PANEL_ID} b,
      #${WINDOW_ID} .cwcf-found {
        color: ${color};
      }

      #${PANEL_ID} .cwcf-muted,
      #${WINDOW_ID} .cwcf-muted {
        color: #d8d8d8;
      }

      #${WINDOW_ID} {
        position: fixed;
        left: ${settings.windowPosition.left}px;
        top: ${settings.windowPosition.top}px;
        z-index: 2147483647;
        width: 310px;
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
        display: flex;
        flex-direction: column;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, .42);
        border-radius: 6px;
        background: rgba(42, 42, 42, .88);
        color: #f4f4f4;
        font: 13px/1.35 Verdana, Arial, sans-serif;
        box-shadow: 0 10px 28px rgba(0, 0, 0, .38);
      }

      #${WINDOW_ID}.cwcf-collapsed .cwcf-body {
        display: none;
      }

      #${WINDOW_ID} .cwcf-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: -4px -4px 8px;
        padding: 4px;
        cursor: move;
        user-select: none;
      }

      #${WINDOW_ID} .cwcf-title b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${WINDOW_ID} .cwcf-actions {
        display: flex;
        gap: 4px;
        flex: none;
      }

      #${WINDOW_ID} button {
        min-width: 26px;
        min-height: 24px;
        border: 1px solid rgba(255, 255, 255, .35);
        border-radius: 4px;
        color: #f5f5f5;
        background: rgba(0, 0, 0, .32);
        font: 700 12px/1 Verdana, Arial, sans-serif;
        cursor: pointer;
      }

      #${WINDOW_ID} button:hover {
        background: rgba(255, 255, 255, .14);
      }

      #${WINDOW_ID} .cwcf-add {
        display: flex;
        gap: 6px;
      }

      #${WINDOW_ID} input[type="text"] {
        width: 100%;
        min-width: 0;
        height: 30px;
        padding: 4px 7px;
        border: 1px solid #b9b9b9;
        border-radius: 4px;
        color: #222;
        background: #fff;
        font: 14px/1 Verdana, Arial, sans-serif;
      }

      #${WINDOW_ID} .cwcf-list {
        display: grid;
        gap: 4px;
        max-height: 220px;
        overflow: auto;
        margin-top: 9px;
        padding-right: 2px;
      }

      #${WINDOW_ID} .cwcf-item {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) 24px;
        align-items: center;
        gap: 6px;
        min-height: 24px;
      }

      #${WINDOW_ID} .cwcf-item input {
        width: 16px;
        height: 16px;
        margin: 0;
      }

      #${WINDOW_ID} .cwcf-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #fff;
      }

      #${WINDOW_ID} .cwcf-item:not(.cwcf-on) .cwcf-name {
        color: #bababa;
        text-decoration: line-through;
      }

      #${WINDOW_ID} .cwcf-remove {
        min-width: 22px;
        width: 22px;
        min-height: 22px;
        height: 22px;
        padding: 0;
      }

      #${WINDOW_ID} .cwcf-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }

      #${WINDOW_ID} .cwcf-footer label {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }

      #${WINDOW_ID} .cwcf-color-control {
        position: relative;
        flex: none;
      }

      #${WINDOW_ID} .cwcf-color-swatch {
        width: 34px;
        min-width: 34px;
        height: 24px;
        min-height: 24px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, .55);
        background: ${color};
      }

      #${WINDOW_ID} .cwcf-color-popover {
        display: none;
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        z-index: 2147483647;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, .42);
        border-radius: 6px;
        background: rgba(24, 24, 24, .96);
        box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
      }

      #${WINDOW_ID} .cwcf-color-control.cwcf-color-open .cwcf-color-popover {
        display: block;
      }

      #${WINDOW_ID} .cwcf-color {
        width: 52px;
        height: 36px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
      }

      @keyframes cwcf-pulse {
        0%, 100% { opacity: .55; }
        50% { opacity: 1; }
      }
    `;
  }

  function clearHighlights() {
    document.querySelectorAll(`#cages td.${HIGHLIGHT_CLASS}`).forEach((td) => {
      td.classList.remove(HIGHLIGHT_CLASS);
      td.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    });

    document.querySelectorAll(`#cages .cat.${CAT_CLASS}`).forEach((cat) => {
      cat.classList.remove(CAT_CLASS);
    });
  }

  function setPanel(matches) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    if (!settings.enabled) {
      panel.innerHTML = `<span class="cwcf-muted">Подсветка выключена.</span>`;
      return;
    }

    if (!getActiveQueries().length) {
      panel.innerHTML = `<span class="cwcf-muted">Добавьте имя или ID.</span>`;
      return;
    }

    const activeQueries = getActiveQueries();
    const missing = activeQueries.filter((query) => !matches.some((match) => isMatch(match, [query])));

    if (!matches.length) {
      panel.innerHTML = `<span class="cwcf-muted">Не найдены: ${escapeHtml(activeQueries.map((query) => query.raw).join(", "))}</span>`;
      return;
    }

    const location = getCurrentLocation();
    const rows = matches
      .map((match) => `${escapeHtml(match.name)}${match.id ? ` [${match.id}]` : ""}: ${match.row}x${match.column}`)
      .join("<br>");
    const missingRows = missing.length
      ? `<br><span class="cwcf-muted">Не найдены: ${escapeHtml(missing.map((query) => query.raw).join(", "))}</span>`
      : "";
    panel.innerHTML = `<b class="cwcf-found">Найдено: ${matches.length}</b>${location ? `<br><span class="cwcf-muted">${escapeHtml(location)}</span>` : ""}<br>${rows}${missingRows}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function renderWindow() {
    let win = document.getElementById(WINDOW_ID);
    const wasFocused = document.activeElement?.id === "cwcf-input";
    const inputValue = wasFocused ? document.activeElement.value : "";

    if (!win) {
      win = document.createElement("div");
      win.id = WINDOW_ID;
      document.body.appendChild(win);
    }

    win.classList.toggle("cwcf-collapsed", settings.collapsed);

    const listHtml = settings.queryItems.length
      ? settings.queryItems.map((item, index) => `
          <div class="cwcf-item ${item.enabled ? "cwcf-on" : ""}">
            <input class="cwcf-toggle" type="checkbox" data-index="${index}" ${item.enabled ? "checked" : ""} title="Подсветка">
            <span class="cwcf-name" title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</span>
            <button class="cwcf-remove" type="button" data-index="${index}" title="Удалить">x</button>
          </div>
        `).join("")
      : `<div class="cwcf-muted">Список пока пуст.</div>`;

    win.innerHTML = `
      <div class="cwcf-title">
        <b>Котонаходиловка</b>
        <div class="cwcf-actions">
          <button class="cwcf-master" type="button" title="Включить/выключить все">${settings.enabled ? "on" : "off"}</button>
          <button class="cwcf-collapse" type="button" title="Свернуть">${settings.collapsed ? "+" : "_"}</button>
        </div>
      </div>
      <div class="cwcf-body">
        <div class="cwcf-add">
          <input id="cwcf-input" type="text" placeholder="Имя, ID или несколько через запятую...">
          <button class="cwcf-add-button" type="button" title="Добавить">+</button>
        </div>
        <div class="cwcf-list">${listHtml}</div>
        <div id="${PANEL_ID}"></div>
        <div class="cwcf-footer">
          <label title="Искать по части имени">
            <input class="cwcf-contains" type="checkbox" ${settings.matchMode === "contains" ? "checked" : ""}>
            <span>часть имени</span>
          </label>
          <div class="cwcf-color-control">
            <button class="cwcf-color-swatch" type="button" title="Цвет подсветки" style="background: ${settings.color}"></button>
            <div class="cwcf-color-popover">
              <input class="cwcf-color" type="color" value="${settings.color}" title="Цвет подсветки">
            </div>
          </div>
        </div>
      </div>
    `;

    const input = win.querySelector("#cwcf-input");
    input.value = inputValue;
    if (wasFocused) input.focus();

    bindWindowEvents(win);
  }

  function bindWindowEvents(win) {
    win.querySelector(".cwcf-add-button").addEventListener("click", addFromInput);
    win.querySelector("#cwcf-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") addFromInput();
    });

    win.querySelector(".cwcf-master").addEventListener("click", () => {
      updateSettings({ enabled: !settings.enabled });
    });

    win.querySelector(".cwcf-collapse").addEventListener("click", () => {
      updateSettings({ collapsed: !settings.collapsed }, true);
    });

    win.querySelector(".cwcf-contains").addEventListener("change", (event) => {
      updateSettings({ matchMode: event.target.checked ? "contains" : "exact" });
    });

    const colorControl = win.querySelector(".cwcf-color-control");
    colorControl.querySelector(".cwcf-color-swatch").addEventListener("click", (event) => {
      event.stopPropagation();
      colorControl.classList.toggle("cwcf-color-open");
    });
    colorControl.querySelector(".cwcf-color-popover").addEventListener("click", (event) => {
      event.stopPropagation();
    });
    colorControl.querySelector(".cwcf-color").addEventListener("input", (event) => {
      updateColor(event.target.value);
    });

    if (!colorOutsideClickBound) {
      colorOutsideClickBound = true;
      document.addEventListener("click", closeColorPopover);
    }

    win.querySelectorAll(".cwcf-toggle").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const index = +event.target.dataset.index;
        const queryItems = settings.queryItems.slice();
        queryItems[index] = { ...queryItems[index], enabled: event.target.checked };
        updateSettings({ queryItems });
      });
    });

    win.querySelectorAll(".cwcf-remove").forEach((button) => {
      button.addEventListener("click", (event) => {
        const index = +event.target.dataset.index;
        const queryItems = settings.queryItems.filter((_item, itemIndex) => itemIndex !== index);
        updateSettings({ queryItems });
      });
    });

    makeDraggable(win);
  }

  function addFromInput() {
    const input = document.getElementById("cwcf-input");
    const values = input.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) return;

    const existing = new Set(settings.queryItems.map((item) => normalize(item.value)));
    const queryItems = settings.queryItems.slice();

    values.forEach((value) => {
      const key = normalize(value);
      if (existing.has(key)) return;
      existing.add(key);
      queryItems.push({ value, enabled: true });
    });

    updateSettings({ queryItems });

    input.value = "";
    input.focus();
  }

  function makeDraggable(win) {
    const handle = win.querySelector(".cwcf-title");
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = win.offsetLeft;
      startTop = win.offsetTop;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - win.offsetWidth, startLeft + event.clientX - startX));
      const top = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, startTop + event.clientY - startY));
      win.style.left = `${left}px`;
      win.style.top = `${top}px`;
    });

    handle.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(event.pointerId);
      updateSettings({ windowPosition: { left: win.offsetLeft, top: win.offsetTop } }, true);
    });
  }

  function updateSettings(partial, quiet = false) {
    settings = migrateSettings({ ...settings, ...partial });
    renderWindow();
    scan();
    saveSettings(quiet);
  }

  function updateColor(color) {
    settings = migrateSettings({ ...settings, color });
    const swatch = document.querySelector(`#${WINDOW_ID} .cwcf-color-swatch`);
    if (swatch) swatch.style.background = color;
    scan();
    saveSettings(true);
  }

  function closeColorPopover(event) {
    const control = document.querySelector(`#${WINDOW_ID} .cwcf-color-control`);
    if (!control || control.contains(event.target)) return;
    control.classList.remove("cwcf-color-open");
  }

  function flashSaved() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const note = document.createElement("div");
    note.className = "cwcf-muted";
    note.textContent = "Сохранено.";
    panel.appendChild(note);
    window.setTimeout(() => note.remove(), 900);
  }

  function scan() {
    observer?.disconnect();
    injectStyle();
    clearHighlights();

    if (!settings.enabled) {
      setPanel([]);
      window.setTimeout(startObserver, 0);
      return [];
    }

    const queries = getActiveQueries();
    const matches = [];

    document.querySelectorAll("#cages tbody tr td").forEach((td) => {
      const link = td.querySelector(".cat_tooltip u a, .cat_tooltip a[href*='cat']");
      if (!link) return;

      const cat = {
        name: link.textContent.trim(),
        id: getCatId(link)
      };

      if (!isMatch(cat, queries)) return;

      const { row, column } = getCellCoords(td);
      const catElement = td.querySelector(".cat");
      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.textContent = cat.name || cat.id;

      td.classList.add(HIGHLIGHT_CLASS);
      td.appendChild(badge);
      catElement?.classList.add(CAT_CLASS);
      matches.push({ ...cat, row, column });
    });

    setPanel(matches);
    window.setTimeout(startObserver, 0);
    return matches;
  }

  function startObserver() {
    observer?.disconnect();
    const target = document.getElementById("cages") || document.body;
    if (!target) return;

    observer = new MutationObserver(() => {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scan, 80);
    });

    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "href"]
    });
  }

  renderWindow();
  scan();
  startObserver();
})();
