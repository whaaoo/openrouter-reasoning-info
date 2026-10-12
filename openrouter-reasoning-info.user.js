// ==UserScript==
// @name         OpenRouter 模型页显示推理信息
// @name:en      OpenRouter: Show Reasoning Info on Model Page
// @namespace    https://openrouter.ai/
// @version      1.0.1
// @description  在 OpenRouter 模型详情页做两件事：(1) 在 RELEASED 卡片后插入同款 REASONING 卡，显示能否关闭推理；(2) 在 Providers 区自带的 Reasoning effort 下拉里给默认等级加 * 标记，折叠后的按钮显示该等级时同样带 *。数据来自官方公开接口 GET /api/v1/models，无需 API Key。
// @description:en On OpenRouter model pages: (1) adds a native-style REASONING card after the RELEASED card showing whether reasoning can be disabled; (2) marks the default effort with * in the page's own Providers "Reasoning effort" dropdown. Data comes from the public GET /api/v1/models endpoint. No API key needed.
// @match        https://openrouter.ai/*
// @homepageURL  https://github.com/whaaoo/openrouter-reasoning-info
// @downloadURL  https://raw.githubusercontent.com/whaaoo/openrouter-reasoning-info/main/openrouter-reasoning-info.user.js
// @updateURL    https://raw.githubusercontent.com/whaaoo/openrouter-reasoning-info/main/openrouter-reasoning-info.user.js
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  var API_URL = 'https://openrouter.ai/api/v1/models';
  var REASONING_CARD_ID = 'or-reasoning-card';
  var FALLBACK_ID = 'or-reasoning-fallback';
  var STAR_CLASS = 'or-default-star';

  // === TESTABLE START ===
  // Pure logic (no DOM access), kept self-contained for unit tests.

  // First path segments that are site pages, not model providers.
  // Even if one slips through, an id missing from the models catalog is ignored later.
  var RESERVED_FIRST_SEGMENTS = {
    activity: 1, apps: 1, blog: 1, careers: 1, chat: 1, compare: 1,
    credits: 1, data: 1, docs: 1, enterprise: 1, explore: 1, features: 1,
    host: 1, keys: 1, labs: 1, legal: 1, pricing: 1, privacy: 1,
    providers: 1, rankings: 1, settings: 1, signin: 1, 'sign-in': 1,
    signup: 1, 'sign-up': 1, state: 1, support: 1, terms: 1, works: 1
  };

  // Model page URL shapes:
  //   /<provider>/<model>            detail page
  //   /<provider>/<model>/<tab>      sub page (e.g. /api), id is still the first two segments
  //   /models/<provider>/<model>     legacy shape, redirects to the first one; handled anyway
  // Model ids have exactly two segments; the second may carry :free / :batch suffixes.
  function parseModelId(pathname) {
    var segments;
    try {
      segments = String(pathname || '')
        .split('/')
        .filter(function (s) { return s.length > 0; })
        .map(function (s) { return decodeURIComponent(s); });
    } catch (e) {
      return null;
    }
    if (segments.length > 0 && segments[0] === 'models') {
      segments = segments.slice(1);
    }
    if (segments.length < 2) return null;
    if (RESERVED_FIRST_SEGMENTS[segments[0]]) return null;
    return segments[0] + '/' + segments[1];
  }

  // The display names the site itself uses in its Providers "Reasoning effort"
  // filter list (the API value xhigh shows as "Extra high" there).
  var EFFORT_LABELS = {
    none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
    high: 'High', xhigh: 'Extra high', max: 'Max'
  };

  // Whether reasoning can be disabled, from reasoning.mandatory.
  // mandatory=true means effort:"none" is rejected; false means it can be turned off.
  function describeCanDisable(reasoning) {
    if (!reasoning || typeof reasoning !== 'object') {
      return { hasReasoning: false, symbol: '—', text: 'None', tone: 'na' };
    }
    if (reasoning.mandatory === true) {
      return { hasReasoning: true, symbol: '✕', text: 'Cannot disable', tone: 'off' };
    }
    if (reasoning.mandatory === false) {
      return { hasReasoning: true, symbol: '✓', text: 'Can disable', tone: 'on' };
    }
    return { hasReasoning: true, symbol: '—', text: 'Unknown', tone: 'na' };
  }

  // The default effort's display name as it appears in the site's own
  // Reasoning effort list, or null when the model exposes no default effort.
  function defaultEffortLabel(reasoning) {
    if (!reasoning || typeof reasoning !== 'object') return null;
    var def = reasoning.default_effort;
    if (typeof def !== 'string' || !def) return null;
    return EFFORT_LABELS[def] || (def.charAt(0).toUpperCase() + def.slice(1));
  }
  // === TESTABLE END ===

  var modelsPromise = null;
  var modelsById = null;

  function loadModels() {
    if (!modelsPromise) {
      modelsPromise = fetch(API_URL, { headers: { 'Accept': 'application/json' } })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        })
        .then(function (json) {
          var byId = {};
          (json.data || []).forEach(function (m) { if (m && m.id) byId[m.id] = m; });
          modelsById = byId;
          return byId;
        })
        .catch(function (err) {
          modelsPromise = null; // allow a later retry
          throw err;
        });
    }
    return modelsPromise;
  }

  function removeOurNodes() {
    [REASONING_CARD_ID, FALLBACK_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // The stat cards (Modalities / In-Out Price / Context / Released) share one
  // structure: an outer div with a "bg-card" class, a header row whose label
  // div holds the caption text, and a value div after the header row.
  // We locate the Released card by its label, then clone it so the new card
  // inherits the site's own classes and always matches its styling.
  function findCardByLabel(labelText) {
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      if (el.childElementCount === 0 && el.textContent.trim() === labelText) {
        var node = el;
        for (var depth = 0; node && depth < 6; depth++) {
          if (typeof node.className === 'string' && node.className.indexOf('bg-card') !== -1) {
            return node;
          }
          node = node.parentElement;
        }
        // Fallback: label div -> header row -> card
        if (el.parentElement && el.parentElement.parentElement) {
          return el.parentElement.parentElement;
        }
      }
    }
    return null;
  }

  function stripIds(root) {
    root.removeAttribute('id');
    var withIds = root.querySelectorAll('[id]');
    for (var i = 0; i < withIds.length; i++) withIds[i].removeAttribute('id');
  }

  // Clone the Released card and swap its label + value.
  // fillValue(valueEl) populates the (emptied) value element.
  function buildCard(releasedCard, id, labelText, fillValue) {
    var clone = releasedCard.cloneNode(true);
    stripIds(clone);
    clone.id = id;
    var labelEl = null;
    var divs = clone.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      if (divs[i].childElementCount === 0 && divs[i].textContent.trim() === 'Released') {
        labelEl = divs[i];
        break;
      }
    }
    if (labelEl) labelEl.textContent = labelText;
    var headerRow = labelEl ? labelEl.parentElement : clone.firstElementChild;
    var valueEl = headerRow ? headerRow.nextElementSibling : null;
    if (!valueEl) valueEl = clone.lastElementChild;
    if (valueEl) {
      valueEl.textContent = '';
      fillValue(valueEl);
    }
    return clone;
  }

  function appendSymbolValue(valueEl, info) {
    var sym = document.createElement('span');
    sym.textContent = info.symbol;
    sym.style.fontWeight = '700';
    if (info.tone === 'off') sym.style.color = '#f87171';
    if (info.tone === 'on') sym.style.color = '#4ade80';
    valueEl.appendChild(sym);
    valueEl.appendChild(document.createTextNode(' ' + info.text));
  }

  function insertCard(entry) {
    if (document.getElementById(REASONING_CARD_ID)) return true;
    var releasedCard = findCardByLabel('Released');
    if (!releasedCard) return false;
    var info = describeCanDisable(entry && entry.reasoning);
    var card = buildCard(releasedCard, REASONING_CARD_ID, 'Reasoning', function (valueEl) {
      appendSymbolValue(valueEl, info);
    });
    releasedCard.insertAdjacentElement('afterend', card);
    return true;
  }

  // If the stat-card row cannot be found (layout change), fall back to a compact
  // one-line panel under the title so the information still shows somewhere.
  function insertFallback(entry) {
    if (document.getElementById(REASONING_CARD_ID) || document.getElementById(FALLBACK_ID)) return;
    var h1 = document.querySelector('h1');
    if (!h1 || !h1.parentNode) return;
    var info = describeCanDisable(entry && entry.reasoning);
    var panel = document.createElement('div');
    panel.id = FALLBACK_ID;
    panel.style.cssText = 'border:1px solid rgba(128,128,128,.4);border-radius:10px;' +
      'padding:8px 12px;margin:10px 0;font-size:14px;background:rgba(128,128,128,.08);';
    var text = 'Reasoning: ' + info.symbol + ' ' + info.text;
    var defLabel = defaultEffortLabel(entry && entry.reasoning);
    if (info.hasReasoning && defLabel) text += '  ·  Default effort: ' + defLabel;
    panel.textContent = text;
    h1.insertAdjacentElement('afterend', panel);
  }

  // --- Marking the default effort in the page's own Reasoning effort list ---
  //
  // The Providers section has a built-in "Reasoning effort" dropdown whose
  // items are bare effort names (All / Low / Medium / High / Extra high / Max).
  // The popup renders only while open (portaled to <body>), so we watch for it:
  // when a container holds at least 3 distinct bare effort names, it is that
  // list, and we append a bold "*" to the item matching the model's default.
  var EFFORT_NAME_SET = {
    'None': 1, 'Minimal': 1, 'Low': 1, 'Medium': 1, 'High': 1,
    'Extra high': 1, 'Max': 1
  };

  function makeStar() {
    var star = document.createElement('span');
    star.className = STAR_CLASS;
    star.textContent = '*';
    star.style.fontWeight = '700';
    star.title = 'Default';
    return star;
  }

  function markDefaultEffortInMenu() {
    if (!currentEntry) return;
    var label = defaultEffortLabel(currentEntry.reasoning);
    if (!label) return;
    var nodes = document.querySelectorAll('div, span, li, [role="option"], [role="menuitem"]');
    var groups = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.childElementCount !== 0) continue;
      var name = el.textContent.trim();
      if (!EFFORT_NAME_SET[name]) continue;
      var container = null;
      if (typeof el.closest === 'function') {
        container = el.closest('[role="listbox"], [role="menu"]');
      }
      if (!container) {
        container = el.parentElement && el.parentElement.parentElement;
      }
      if (!container) continue;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push({ el: el, name: name });
    }
    groups.forEach(function (items) {
      var distinct = {};
      items.forEach(function (it) { distinct[it.name] = 1; });
      if (Object.keys(distinct).length < 3) return; // not the effort list
      items.forEach(function (it) {
        if (it.name !== label) return;
        var host = it.el;
        if (host.querySelector && host.querySelector('.' + STAR_CLASS)) return;
        if (host.parentElement && host.parentElement.querySelector('.' + STAR_CLASS)) return;
        host.appendChild(makeStar());
      });
    });
  }

  // The collapsed select button shows the currently selected value. When that
  // value is the model's default effort, it gets the same "*" — otherwise the
  // mark seems to vanish as soon as the user picks the default from the list.
  // The button is located via the "Reasoning effort" label next to it, so the
  // neighbouring selects (routing mode, latency) are never touched.
  function markDefaultOnTrigger() {
    if (!currentEntry) return;
    var label = defaultEffortLabel(currentEntry.reasoning);
    if (!label) return;
    var spans = document.querySelectorAll('span, label, div');
    for (var i = 0; i < spans.length; i++) {
      var anchor = spans[i];
      if (anchor.textContent.trim() !== 'Reasoning effort') continue;
      // The label element wraps the caption text plus a small info button
      // (button/svg descendants only); anything with nested text containers
      // is a larger block that merely contains the phrase.
      if (anchor.querySelectorAll('span, div, label, p').length !== 0) continue;
      var container = anchor;
      for (var depth = 0; container && depth < 6; depth++) {
        var buttons = container.querySelectorAll('button, [role="combobox"]');
        for (var b = 0; b < buttons.length; b++) {
          var btn = buttons[b];
          if (btn.textContent.trim() !== label) continue;
          if (btn.querySelector('.' + STAR_CLASS)) continue;
          var leaves = btn.querySelectorAll('span, div');
          for (var l = 0; l < leaves.length; l++) {
            if (leaves[l].childElementCount === 0 && leaves[l].textContent.trim() === label) {
              leaves[l].appendChild(makeStar());
              break;
            }
          }
        }
        container = container.parentElement;
      }
    }
  }

  function markAll() {
    markDefaultEffortInMenu();
    markDefaultOnTrigger();
  }

  var markTimer = null;
  function scheduleMark() {
    if (markTimer) return;
    markTimer = setTimeout(function () {
      markTimer = null;
      markAll();
    }, 150);
  }

  var currentId = null;
  var currentEntry = null;
  var renderSeq = 0;

  function tryRender() {
    if (!currentEntry) return;
    if (!insertCard(currentEntry)) insertFallback(currentEntry);
    scheduleMark();
  }

  function update(force) {
    var modelId = parseModelId(location.pathname);
    if (!modelId) {
      removeOurNodes();
      currentId = null;
      currentEntry = null;
      return;
    }
    if (modelId !== currentId) {
      removeOurNodes();
      currentId = modelId;
      currentEntry = null;
    } else if (!force && (document.getElementById(REASONING_CARD_ID) || document.getElementById(FALLBACK_ID))) {
      return;
    }
    var seq = ++renderSeq;
    loadModels().then(function (byId) {
      if (seq !== renderSeq) return;
      var entry = byId[modelId];
      if (!entry) {
        removeOurNodes();
        return;
      }
      currentEntry = entry;
      tryRender();
    }).catch(function () {
      // Stay silent on the page; a later navigation or re-render retries.
    });
  }

  // SPA navigation does not reload the page; poll for URL changes.
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      update(false);
    }
  }, 500);

  // The page hydrates and re-renders asynchronously: if our card is missing
  // (not inserted yet, or wiped by a re-render), insert it again. If only the
  // fallback panel is showing but the Released card has appeared since, upgrade
  // the fallback to the real card. DOM changes may also be the Reasoning
  // effort popup opening, so schedule a marking pass as well.
  var domObserver = new MutationObserver(function () {
    if (!currentEntry) return;
    if (!document.getElementById(REASONING_CARD_ID)) {
      if (findCardByLabel('Released')) {
        var fb = document.getElementById(FALLBACK_ID);
        if (fb) fb.remove();
        insertCard(currentEntry);
      }
    }
    scheduleMark();
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Clicks open/close the dropdown and change its value; give the UI a moment
  // to settle, then re-apply both marks.
  document.addEventListener('click', function () {
    scheduleMark();
    setTimeout(markAll, 350);
    setTimeout(markAll, 800);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { update(false); });
  } else {
    update(false);
  }
})();
