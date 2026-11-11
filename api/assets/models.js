/* Shared data layer for the /api model pages (catalog, detail, pricing): fetches model_public_catalog and
 * model_health from the chat gateway, dedupes by canonicalId, folds model_catalog groups into cards,
 * formats ¥ prices, and paints the cover fallback. Page scripts only read window.NexusModels.
 *
 * Ported from chat/api/oai-models.js, which still drives the old /chat/api_models page: the featured /
 * pareto / free lists, the grouping primitives (MG) and the "cheapest line" / "best line" rules are the
 * same there — change both files together. */
(function () {
  "use strict";

  var GW_PATH = "/functions/v1/chat-gateway";
  var GW_FALLBACK = "https://chat.nexusvai.xyz" + GW_PATH;
  var BASE_URL = "https://cn.nexusvai.xyz/v1";
  var CACHE_KEY = "nexus.api.models.catalog.v1";
  var CACHE_TTL_MS = 120000;

  // Flagship cards: only ids still in the catalog show up; group members fold onto their card and
  // nothing outside the list fills a gap. Free lines never go here (they would drop out of 免费模型).
  var FEATURED_ORDER = [
    "claude-opus-5.5",
    "claude-sonnet-5.5",
    "kimi-k3.1-pro",
    "gemini-4-argon",
    "gpt-6.1-sol",
    "gpt-6-astra",
    "gpt-6-sol",
    "glm-5.3",
    "deepseek-v4.1-flash",
    "claude-opus-4-6-thinking",
    "claude-opus-5",
    "claude-opus-5-5-kiro",
    "claude-fable-5-2",
    "deepseek-v4-pro",
  ];
  // Members that get their own flagship card instead of folding onto the group's card.
  var FEATURED_STANDALONE = { "claude-opus-5-5-kiro": true };
  // 帕累托前沿: picked for capability per yuan, same folding rules as the flagship list.
  var PARETO_ORDER = [
    "claude-haiku-5.5",
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6-thinking",
    "gpt-6.1-sol",
    "kimi-k3",
    "composer-2.5-fast",
    "deepseek-v4.1-flash",
    "minimax-m3.1-flash",
    "glm-5.3-flash",
    "glm-5.3-flashx",
    "qwen3.8-flash",
    "gemini-4-argon",
    "mimo-v2.6-flash",
    "mimo-v2.6-pro",
  ];
  // Free section: these first, then every other free-tier line in catalog order. Never folded,
  // otherwise a free line would turn into its paid group card.
  var FREE_ORDER = [
    "kimi-k3-fp8-block-free",
    "claude-sonnet-5-free",
    "glm-5.3-flash-free",
    "hy3-free",
    "qwen3.8-flash-free",
    "grok-4.5-free",
    "deepseek-v4-flash-vision-exp-free",
    "mimo-v2.5-free",
    "grok-4.6-free",
    "deepseek-v4-flash",
    "claude-opus-4.8-free",
    "kimi-k3-high",
    "nexusvai:minimax-m3-free",
    "glm-5.2-fp8",
  ];
  // Paid snapshots that must never render in the free section.
  var FREE_BLOCKLIST = { "deepseek-v4-pro-0813": true, "deepseek-v4-flash-0731": true };
  // Cards that show no description at all (operator request).
  var HIDE_CARD_DESC = { "kimi-k3": true, "deepseek-v4-pro-0813": true };
  var HIDE_IDS = {
    "z-image-turbo": 1, "grok-imagine-image-lite": 1, "gpt-image-2-all": 1,
    "tongyi-xiaomi-analysis-pro": 1, "gui-plus": 1, "mistral-medium-3-5": 1,
    "ministral-14b-2512": 1, "mistral-large-2512": 1, "mistral-small-2603": 1,
    "or:arcee-ai/trinity-large-thinking": 1,
  };
  var BRAND_LABELS = { Nvidia: "NVIDIA" };
  // Vendor logos: the chat app's model-menu mapping (chat/src/main.js BRAND_ICON_MAP), as site paths.
  var BRAND_ICON = {
    OpenAI: "/chat/openai.svg", Anthropic: "/chat/claude-color.svg", Google: "/chat/gemini-color.svg",
    Qwen: "/chat/qwen-color.svg", Wan: "/chat/qwen-color.svg", DeepSeek: "/chat/deepseek-color.svg",
    Moonshot: "/chat/moonshot.svg", Zhipu: "/chat/zhipu-color.svg", MiniMax: "/chat/minimax-color.svg",
    xAI: "/chat/grok.svg", Mistral: "/chat/mistral-color.svg", Meta: "/chat/meta-color.svg",
    NVIDIA: "/chat/nvidia-color.svg", Nvidia: "/chat/nvidia-color.svg", Doubao: "/chat/doubao-color.svg",
    Baidu: "/chat/wenxin-color.svg", SenseNova: "/chat/sensenova-color.svg",
    "Inclusion AI": "/chat/antgroup-color.svg", InclusionAI: "/chat/antgroup-color.svg",
    Stepfun: "/chat/stepfun-color.svg", KwaiKAT: "/chat/kwaikat.svg", Cursor: "/chat/cursor.svg",
    Clawto: "/chat/openai.svg", Microsoft: "/chat/microsoft-color.svg", IBM: "/chat/ibm.svg",
    Cohere: "/chat/cohere-color.svg", Baichuan: "/chat/baichuan-color.svg", Tencent: "/chat/yuanbao-color.svg",
    "小米 MiMo": "/chat/xiaomimimo-color.svg", Nex: "/chat/NEX_logo.svg", Cancri: "/Logo/Cancri1.jpg",
  };
  // Black single-colour files that flip in dark mode (chat/cancri_logo_theme.js MONO_ICON_FILES).
  var MONO_ICON = { "openai.svg": 1, "kwaikat.svg": 1, "cursor.svg": 1, "ibm.svg": 1, "grok.svg": 1, "xiaomimimo-color.svg": 1, "moonshot.svg": 1 };
  var VENDOR_ORDER = ["OpenAI", "Anthropic", "Google", "xAI", "DeepSeek", "Zhipu", "Qwen", "Moonshot", "MiniMax", "小米 MiMo", "Doubao"];
  // Overridden by catalog.multiplier_legend; only used when a model has no ¥ price at all.
  var COST_TIER_MULTIPLIER = { free: 0.5, cheap: 1, normal: 2, expensive: 5, vip: 15 };
  // model_pricing.cached_input_factor is 0.1 for every row except the ids below (模型运维总纲 §10.1); the
  // catalog does not send it, so cached-input prices are derived here. Change this together with the DB.
  var CACHE_READ_FACTOR = 0.1;
  var CACHE_READ_FACTOR_BY_ID = { "claude-opus-5.5": 0.3, "claude-opus-5.5-thinking": 0.3 };

  var svg = function (cls, body, extra) {
    return '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"' + (cls ? ' class="' + cls + '"' : "") + (extra || "") + ">" + body + "</svg>";
  };
  var ICON = {
    copy: function (cls) {
      return svg(cls, '<path d="M12.7587 2H16.2413C17.0463 1.99999 17.7106 1.99998 18.2518 2.04419C18.8139 2.09012 19.3306 2.18868 19.816 2.43597C20.5686 2.81947 21.1805 3.43139 21.564 4.18404C21.8113 4.66937 21.9099 5.18608 21.9558 5.74817C22 6.28936 22 6.95372 22 7.75868V11.2413C22 12.0463 22 12.7106 21.9558 13.2518C21.9099 13.8139 21.8113 14.3306 21.564 14.816C21.1805 15.5686 20.5686 16.1805 19.816 16.564C19.3306 16.8113 18.8139 16.9099 18.2518 16.9558C17.8906 16.9853 17.4745 16.9951 16.9984 16.9984C16.9951 17.4745 16.9853 17.8906 16.9558 18.2518C16.9099 18.8139 16.8113 19.3306 16.564 19.816C16.1805 20.5686 15.5686 21.1805 14.816 21.564C14.3306 21.8113 13.8139 21.9099 13.2518 21.9558C12.7106 22 12.0463 22 11.2413 22H7.75868C6.95372 22 6.28936 22 5.74818 21.9558C5.18608 21.9099 4.66937 21.8113 4.18404 21.564C3.43139 21.1805 2.81947 20.5686 2.43597 19.816C2.18868 19.3306 2.09012 18.8139 2.04419 18.2518C1.99998 17.7106 1.99999 17.0463 2 16.2413V12.7587C1.99999 11.9537 1.99998 11.2894 2.04419 10.7482C2.09012 10.1861 2.18868 9.66937 2.43597 9.18404C2.81947 8.43139 3.43139 7.81947 4.18404 7.43598C4.66937 7.18868 5.18608 7.09012 5.74817 7.04419C6.10939 7.01468 6.52548 7.00487 7.00162 7.00162C7.00487 6.52548 7.01468 6.10939 7.04419 5.74817C7.09012 5.18608 7.18868 4.66937 7.43598 4.18404C7.81947 3.43139 8.43139 2.81947 9.18404 2.43597C9.66937 2.18868 10.1861 2.09012 10.7482 2.04419C11.2894 1.99998 11.9537 1.99999 12.7587 2ZM9.00176 7L11.2413 7C12.0463 6.99999 12.7106 6.99998 13.2518 7.04419C13.8139 7.09012 14.3306 7.18868 14.816 7.43598C15.5686 7.81947 16.1805 8.43139 16.564 9.18404C16.8113 9.66937 16.9099 10.1861 16.9558 10.7482C17 11.2894 17 11.9537 17 12.7587V14.9982C17.4455 14.9951 17.7954 14.9864 18.089 14.9624C18.5274 14.9266 18.7516 14.8617 18.908 14.782C19.2843 14.5903 19.5903 14.2843 19.782 13.908C19.8617 13.7516 19.9266 13.5274 19.9624 13.089C19.9992 12.6389 20 12.0566 20 11.2V7.8C20 6.94342 19.9992 6.36113 19.9624 5.91104C19.9266 5.47262 19.8617 5.24842 19.782 5.09202C19.5903 4.7157 19.2843 4.40973 18.908 4.21799C18.7516 4.1383 18.5274 4.07337 18.089 4.03755C17.6389 4.00078 17.0566 4 16.2 4H12.8C11.9434 4 11.3611 4.00078 10.911 4.03755C10.4726 4.07337 10.2484 4.1383 10.092 4.21799C9.7157 4.40973 9.40973 4.7157 9.21799 5.09202C9.1383 5.24842 9.07337 5.47262 9.03755 5.91104C9.01357 6.20463 9.00489 6.55447 9.00176 7ZM5.91104 9.03755C5.47262 9.07337 5.24842 9.1383 5.09202 9.21799C4.7157 9.40973 4.40973 9.7157 4.21799 10.092C4.1383 10.2484 4.07337 10.4726 4.03755 10.911C4.00078 11.3611 4 11.9434 4 12.8V16.2C4 17.0566 4.00078 17.6389 4.03755 18.089C4.07337 18.5274 4.1383 18.7516 4.21799 18.908C4.40973 19.2843 4.7157 19.5903 5.09202 19.782C5.24842 19.8617 5.47262 19.9266 5.91104 19.9624C6.36113 19.9992 6.94342 20 7.8 20H11.2C12.0566 20 12.6389 19.9992 13.089 19.9624C13.5274 19.9266 13.7516 19.8617 13.908 19.782C14.2843 19.5903 14.5903 19.2843 14.782 18.908C14.8617 18.7516 14.9266 18.5274 14.9624 18.089C14.9992 17.6389 15 17.0566 15 16.2V12.8C15 11.9434 14.9992 11.3611 14.9624 10.911C14.9266 10.4726 14.8617 10.2484 14.782 10.092C14.5903 9.7157 14.2843 9.40973 13.908 9.21799C13.7516 9.1383 13.5274 9.07337 13.089 9.03755C12.6389 9.00078 12.0566 9 11.2 9H7.8C6.94342 9 6.36113 9.00078 5.91104 9.03755Z" fill="currentColor"></path>');
    },
    check: function (cls) {
      return svg(cls, '<path fill-rule="evenodd" d="M18.063 5.674a1 1 0 0 1 .263 1.39l-7.5 11a1 1 0 0 1-1.533.143l-4.5-4.5a1 1 0 1 1 1.414-1.414l3.647 3.647 6.82-10.003a1 1 0 0 1 1.39-.263Z" clip-rule="evenodd"></path>');
    },
    chevronDown: function (cls) {
      return svg(cls, '<path fill-rule="evenodd" d="M4.293 8.293a1 1 0 0 1 1.414 0L12 14.586l6.293-6.293a1 1 0 1 1 1.414 1.414l-7 7a1 1 0 0 1-1.414 0l-7-7a1 1 0 0 1 0-1.414Z" clip-rule="evenodd"></path>');
    },
    chevronLeft: function (cls) {
      return svg(cls, '<path fill-rule="evenodd" d="M15.707 4.293a1 1 0 0 1 0 1.414L9.414 12l6.293 6.293a1 1 0 0 1-1.414 1.414l-7-7a1 1 0 0 1 0-1.414l7-7a1 1 0 0 1 1.414 0Z" clip-rule="evenodd"></path>');
    },
    external: function (cls) {
      return svg(cls, '<path fill-rule="evenodd" d="M16.243 6.757a1 1 0 0 1 1 1v7.072a1 1 0 0 1-2 0v-4.657L8.464 16.95a1 1 0 0 1-1.414-1.414l6.778-6.779H9.172a1 1 0 0 1 0-2h7.07Z" clip-rule="evenodd"></path>', ' data-external-link-indicator="true"');
    },
  };

  // ── small helpers ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var escAttr = esc;
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function lower(s) {
    return String(s == null ? "" : s).toLowerCase();
  }
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function detailUrl(id) {
    return "/api/docs/models/detail/?model=" + encodeURIComponent(id);
  }

  // ── gateway ────────────────────────────────────────────────────────────
  function gatewayUrls() {
    var base = String(window.__SUPABASE_URL__ || "").replace(/\/+$/, "");
    var list = base ? [base + GW_PATH] : [];
    if (list.indexOf(GW_FALLBACK) === -1) list.push(GW_FALLBACK);
    return list;
  }

  function postOnce(url, body, timeoutMs) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, timeoutMs);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ || "" },
      body: JSON.stringify(body),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(
        function (data) {
          clearTimeout(timer);
          return data;
        },
        function (err) {
          clearTimeout(timer);
          throw err && err.name === "AbortError" ? new Error("请求超时") : err;
        },
      );
  }

  // 12 s on the configured gateway, then 20 s on the fallback (or the same URL again), then one more try
  // after a short pause. From mainland networks the first TLS connection to chat.nexusvai.xyz is often
  // closed during setup; a fresh connection usually goes through.
  function postGateway(body) {
    var urls = gatewayUrls();
    var attempts = [[urls[0], 12000, 0], [urls[1] || urls[0], 20000, 0], [urls[0], 15000, 1000]];
    var i = 0;
    function next(lastErr) {
      if (i >= attempts.length) return Promise.reject(lastErr || new Error("网络错误"));
      var a = attempts[i++];
      return new Promise(function (resolve) {
        setTimeout(resolve, a[2]);
      }).then(function () {
        return postOnce(a[0], body, a[1]);
      }).catch(next);
    }
    return next();
  }

  // ── grouping primitives (same semantics as MG in chat/api/oai-models.js) ─
  function modelId(m) {
    return String((m && (m.id || m.canonicalId)) || "");
  }
  function groupIdOf(m) {
    var g = m && m.group;
    if (!g || typeof g !== "object") return "";
    return g.id == null ? "" : String(g.id).trim();
  }
  function rankOf(m) {
    var g = m && m.group;
    var n = g ? Number(g.rank) : NaN;
    return isFinite(n) ? n : 0;
  }
  function variantOf(m) {
    var g = m && m.group;
    return g && g.variant != null ? String(g.variant).trim() : "";
  }

  function indexModels(list) {
    var byId = {};
    var order = [];
    list.forEach(function (m, i) {
      var gid = groupIdOf(m);
      if (!gid) return;
      if (!byId[gid]) {
        byId[gid] = { id: gid, label: "", members: [], order: i };
        order.push(gid);
      }
      byId[gid].members.push(m);
    });
    var repOfModel = {};
    var groups = order.map(function (gid) {
      var grp = byId[gid];
      grp.members.sort(function (a, b) {
        var d = rankOf(a) - rankOf(b);
        if (d !== 0) return d;
        return modelId(a) < modelId(b) ? -1 : modelId(a) > modelId(b) ? 1 : 0;
      });
      // Card name: an explicit group_label wins (needed when only a side line is left), else the lead's name.
      var explicit = "";
      grp.members.some(function (mem) {
        var lbl = mem.group && mem.group.label != null ? String(mem.group.label).trim() : "";
        if (lbl) explicit = lbl;
        return !!lbl;
      });
      var lead = grp.members[0];
      grp.label = explicit || String(lead.displayName || lead.id || grp.id);
      var repId = modelId(lead);
      grp.members.forEach(function (mem) {
        var mid = modelId(mem);
        if (mid) repOfModel[mid] = repId;
      });
      return grp;
    });
    return { groups: groups, byId: byId, repOfModel: repOfModel };
  }

  // One card per group with ≥ 2 members (shallow copy of the lead + groupInfo); everything else passes through.
  function collapse(list, idx) {
    var emitted = {};
    var out = [];
    list.forEach(function (m) {
      var gid = groupIdOf(m);
      if (!gid) {
        out.push(m);
        return;
      }
      if (emitted[gid]) return;
      emitted[gid] = true;
      var grp = idx.byId[gid];
      if (!grp || grp.members.length < 2) {
        out.push(m);
        return;
      }
      var lead = grp.members[0];
      var card = assign({}, lead);
      card.id = modelId(lead);
      card.displayName = grp.label;
      card.groupInfo = {
        id: grp.id,
        label: grp.label,
        members: grp.members,
        variants: grp.members.map(function (mem) {
          return { id: modelId(mem), variant: variantOf(mem) || String(mem.displayName || mem.id || "") };
        }),
      };
      out.push(card);
    });
    return out;
  }

  // Dedupe by canonicalId (prefer an available entry, keep any description), drop hidden ids,
  // then pull featured ids to the front.
  function dedupe(raw) {
    var byCanonical = {};
    var order = [];
    raw.forEach(function (m) {
      var cid = m && (m.canonicalId || m.id);
      if (!cid) return;
      var ex = byCanonical[cid];
      if (!ex) {
        byCanonical[cid] = assign({}, m, { id: cid });
        order.push(cid);
        return;
      }
      if (ex.available === false && m.available !== false) assign(ex, m, { id: cid });
      if (!ex.publicDescription && m.publicDescription) ex.publicDescription = m.publicDescription;
    });
    var rank = {};
    FEATURED_ORDER.forEach(function (id, i) {
      rank[id.toLowerCase()] = i;
    });
    return order
      .map(function (cid) {
        return byCanonical[cid];
      })
      .filter(function (m) {
        return !HIDE_IDS[m.id];
      })
      .sort(function (a, b) {
        var ra = rank[lower(a.id)];
        var rb = rank[lower(b.id)];
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return 0;
      });
  }

  function brandOf(m) {
    return (m && m.brand) || "其他";
  }
  function brandLabel(b) {
    return BRAND_LABELS[b] || b;
  }

  function prepare(data) {
    var legend = data.multiplier_legend || {};
    Object.keys(legend).forEach(function (k) {
      if (num(legend[k]) != null) COST_TIER_MULTIPLIER[k] = num(legend[k]);
    });
    var raw = dedupe(data.models);
    var idx = indexModels(raw);
    var cards = collapse(raw, idx);
    var byId = {};
    raw.forEach(function (m) {
      byId[lower(m.id)] = m;
    });
    // Line keys whose canonicalId differs still resolve to the deduped entry.
    data.models.forEach(function (m) {
      if (m && m.id && m.canonicalId && !byId[lower(m.id)] && byId[lower(m.canonicalId)]) byId[lower(m.id)] = byId[lower(m.canonicalId)];
    });
    var cardById = {};
    cards.forEach(function (c) {
      cardById[lower(c.id)] = c;
    });

    function get(id) {
      return byId[lower(id)] || null;
    }
    function repId(id) {
      var m = get(id);
      var key = m ? m.id : String(id || "");
      return idx.repOfModel[key] || key;
    }
    function pick(order, standalone) {
      var seen = {};
      var out = [];
      order.forEach(function (id) {
        var key = id.toLowerCase();
        if (standalone && standalone[key]) {
          var own = get(id);
          if (own && !seen[key]) {
            seen[key] = true;
            out.push(own);
          }
          return;
        }
        var rid = lower(repId(id));
        var hit = cardById[rid];
        if (!hit || seen[rid]) return;
        seen[rid] = true;
        out.push(hit);
      });
      return out;
    }

    return {
      raw: raw,
      cards: cards,
      count: raw.length,
      billingMode: data.billing_mode || "",
      get: get,
      repId: repId,
      card: function (id) {
        return cardById[lower(repId(id))] || null;
      },
      // Members of the model's group sorted by rank, or null when it is ungrouped / alone.
      members: function (id) {
        var m = get(id);
        var grp = m && idx.byId[groupIdOf(m)];
        return grp && grp.members.length > 1 ? grp.members : null;
      },
      featured: function () {
        return pick(FEATURED_ORDER, FEATURED_STANDALONE);
      },
      pareto: function () {
        return pick(PARETO_ORDER, null);
      },
      free: function () {
        var seen = {};
        var out = [];
        function add(m) {
          var key = lower(m && m.id);
          if (!m || seen[key] || FREE_BLOCKLIST[key]) return;
          seen[key] = true;
          out.push(m);
        }
        FREE_ORDER.forEach(function (id) {
          add(get(id));
        });
        raw.forEach(function (m) {
          if (isFree(m)) add(m);
        });
        return out;
      },
      // [{ brand, list }] in VENDOR_ORDER, the rest by name, 「其他」 last.
      vendors: function (list) {
        var byBrand = {};
        var brands = [];
        (list || cards).forEach(function (m) {
          var b = brandOf(m);
          if (!byBrand[b]) {
            byBrand[b] = [];
            brands.push(b);
          }
          byBrand[b].push(m);
        });
        function rank(b) {
          if (b === "其他") return 1e9;
          var i = VENDOR_ORDER.indexOf(b);
          return i === -1 ? VENDOR_ORDER.length : i;
        }
        brands.sort(function (a, b) {
          return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
        });
        return brands.map(function (b) {
          return { brand: b, label: brandLabel(b), list: byBrand[b] };
        });
      },
    };
  }

  function readCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (c && Date.now() - c.t < CACHE_TTL_MS && c.data && Array.isArray(c.data.models)) return c.data;
    } catch (e) {}
    return null;
  }
  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data }));
    } catch (e) {}
  }

  var pending = null;
  // Resolves to a prepared catalog. A copy fetched by another model page in this tab within the last
  // two minutes is reused; { fresh: true } always goes to the network (retry buttons).
  function load(opts) {
    var cached = !(opts && opts.fresh) && readCache();
    if (cached) return Promise.resolve(withSearch(prepare(cached)));
    if (!window.__SUPABASE_ANON_KEY__) return Promise.reject(new Error("站点配置未就绪，请刷新页面"));
    if (!pending) {
      pending = postGateway({ endpoint: "model_public_catalog" }).then(
        function (data) {
          pending = null;
          if (!data || !Array.isArray(data.models)) throw new Error("模型目录格式异常");
          writeCache(data);
          return withSearch(prepare(data));
        },
        function (err) {
          pending = null;
          throw err;
        },
      );
    }
    return pending;
  }

  // ── search: every callable id goes into the header search (shell.js reads __apiSearchExtra) ──
  var searchFilled = false;
  function withSearch(cat) {
    if (!searchFilled) {
      searchFilled = true;
      var list = (window.__apiSearchExtra = window.__apiSearchExtra || []);
      cat.raw.forEach(function (m) {
        list.push({ t: m.displayName || m.id, u: detailUrl(m.id), s: "模型", d: description(m) || priceText(m), h: [], x: m.id });
      });
    }
    return cat;
  }

  // ── health (近 24 小时): sampled real user requests from model_health_logs, not probes ──
  var healthPromise = null;
  var healthById = {};
  function loadHealth() {
    if (!healthPromise) {
      healthPromise = postGateway({ endpoint: "model_health", window_days: 1 }).then(
        function (data) {
          (Array.isArray(data && data.models) ? data.models : []).forEach(function (row) {
            var id = lower(row && row.model_id);
            if (id) healthById[id] = row;
          });
          return healthById;
        },
        function () {
          return healthById;
        },
      );
    }
    return healthPromise;
  }
  function healthRow(id) {
    return healthById[lower(id)] || null;
  }
  function hourlyFor(id) {
    var row = healthRow(id);
    return row && Array.isArray(row.hourly) ? row.hourly : null;
  }
  // A folded card shows the best line per hour: one healthy line means the card is usable.
  // Sampled hours beat empty ones; then higher success rate; then more samples.
  function bestHourly(ids) {
    var lists = ids.map(hourlyFor).filter(Boolean);
    if (!lists.length) return null;
    if (lists.length === 1) return lists[0];
    var out = [];
    for (var hr = 0; hr < 24; hr++) {
      var best = null;
      for (var j = 0; j < lists.length; j++) {
        var cur = lists[j][hr];
        if (!cur) continue;
        if (!best) {
          best = cur;
          continue;
        }
        var cT = Number(cur.total) || 0;
        var bT = Number(best.total) || 0;
        if (bT <= 0) {
          if (cT > 0) best = cur;
          continue;
        }
        if (cT <= 0) continue;
        var cR = typeof cur.success_rate === "number" ? cur.success_rate : null;
        var bR = typeof best.success_rate === "number" ? best.success_rate : null;
        if (cR == null) continue;
        if (bR == null || cR > bR || (cR === bR && cT > bT)) best = cur;
      }
      out.push(best || { hour: "", total: 0, success_rate: null });
    }
    return out;
  }
  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function hourTip(hourIso, total, rate) {
    var d = new Date(hourIso);
    if (!hourIso || isNaN(d.getTime())) return total ? "成功率 " + rate + "% · " + total + " 次" : "无调用样本";
    var end = new Date(d.getTime() + 3600000);
    var span = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + "–" + pad2(end.getHours()) + ":" + pad2(end.getMinutes());
    return total ? span + " 成功率 " + rate + "% · " + total + " 次" : span + " 无调用样本";
  }
  function uptimeHtml(hourly, size) {
    var hours = Array.isArray(hourly) ? hourly : [];
    var max = 1;
    hours.forEach(function (h) {
      var t = Number(h && h.total) || 0;
      if (t > max) max = t;
    });
    var segs = "";
    for (var i = 0; i < 24; i++) {
      var h = hours[i] || {};
      var total = Number(h.total) || 0;
      var rate = typeof h.success_rate === "number" ? h.success_rate : null;
      var state = total > 0 ? (rate != null && rate >= 90 ? "ok" : "bad") : "empty";
      var ratio = total > 0 ? Math.max(0.42, total / max) : 0.34;
      segs += '<span class="models-uptime__seg" data-state="' + state + '" style="height:' + Math.round(ratio * 100) + '%" title="' + escAttr(hourTip(h.hour, total, rate)) + '"></span>';
    }
    return '<div class="models-uptime"' + (size ? ' data-size="' + size + '"' : "") + ' role="img" aria-label="近 24 小时用户请求成功率">' + segs + "</div>";
  }

  // ── prices ─────────────────────────────────────────────────────────────
  function isFree(m) {
    return !!m && (m.gateCostTier === "free" || m.costTier === "free");
  }
  function costMultiplier(m) {
    if (m && typeof m.customMultiplier === "number") return m.customMultiplier;
    var v = COST_TIER_MULTIPLIER[(m && m.costTier) || "normal"];
    return v == null ? 1 : v;
  }
  function trim(n) {
    return (Math.round(Number(n) * 1e6) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }
  function yen(n) {
    return n == null ? "—" : "¥" + trim(n);
  }
  // Table style: at least two decimals, like OpenAI's "$10.00" / "$0.125".
  function yenFixed(n) {
    if (n == null) return "—";
    var s = trim(n);
    var dot = s.indexOf(".");
    if (dot === -1) return "¥" + s + ".00";
    return "¥" + s + (s.length - dot - 1 < 2 ? "0" : "");
  }
  function fmtMult(n) {
    return trim(n) + "×";
  }
  function cacheReadFactor(m) {
    var f = CACHE_READ_FACTOR_BY_ID[modelId(m)];
    return typeof f === "number" ? f : CACHE_READ_FACTOR;
  }
  // { kind: free | token | call | display | mult } — free first, then structured ¥ prices, then the
  // catalog's display string, then the legacy billing multiplier.
  function priceOf(m) {
    if (isFree(m)) return { kind: "free" };
    var input = num(m && m.inputPricePerM);
    var output = num(m && m.outputPricePerM);
    if (input != null || output != null) {
      var factor = cacheReadFactor(m);
      return { kind: "token", input: input, output: output, cacheFactor: factor, cached: input != null && input > 0 ? Math.round(input * factor * 1e6) / 1e6 : null };
    }
    var call = num(m && m.perCallPrice);
    if (call != null) return { kind: "call", call: call };
    if (m && typeof m.priceDisplay === "string" && m.priceDisplay) return { kind: "display", text: m.priceDisplay };
    return { kind: "mult", mult: costMultiplier(m) };
  }
  function priceText(m) {
    var p = priceOf(m);
    if (p.kind === "free") return "免费";
    if (p.kind === "token") return "输入 " + yen(p.input) + " · 输出 " + yen(p.output) + " / 百万 token";
    if (p.kind === "call") return yen(p.call) + " / 次";
    if (p.kind === "display") return p.text;
    return fmtMult(p.mult) + " token 倍率";
  }
  // The cheapest line of a folded card. Never compares ¥/1M tokens with ¥/call: a free line wins,
  // then the lowest token input price, then the lowest per-call price, else the card itself.
  function cheapestMember(card) {
    var list = (card && card.groupInfo && card.groupInfo.members) || [];
    if (list.length < 2) return card;
    var i;
    for (i = 0; i < list.length; i++) if (isFree(list[i])) return list[i];
    var best = null;
    var bestN = null;
    for (i = 0; i < list.length; i++) {
      var t = num(list[i].inputPricePerM);
      if (t != null && (bestN == null || t < bestN)) {
        bestN = t;
        best = list[i];
      }
    }
    if (best) return best;
    for (i = 0; i < list.length; i++) {
      var c = num(list[i].perCallPrice);
      if (c != null && (bestN == null || c < bestN)) {
        bestN = c;
        best = list[i];
      }
    }
    return best || card;
  }

  function errorText(err) {
    var msg = String((err && err.message) || err || "");
    var http = msg.match(/^HTTP (\d+)/);
    if (http) return "服务暂时不可用（HTTP " + http[1] + "）";
    if (!msg || (err && err.name === "TypeError") || /fetch|network/i.test(msg)) return "网络连接失败";
    return msg;
  }

  function description(m) {
    var id = modelId(m);
    if (HIDE_CARD_DESC[id]) return "";
    return (m && m.publicDescription) || (m && m.brand ? m.brand + " 模型" : "");
  }

  // ── tokens ─────────────────────────────────────────────────────────────
  function compactTokens(n) {
    n = num(n);
    if (!n || n <= 0) return "";
    if (n >= 1e6) return trim(Math.round(n / 1e4) / 100) + "M";
    if (n >= 1e3) return trim(Math.round(n / 100) / 10) + "K";
    return String(n);
  }
  function groupDigits(n) {
    n = num(n);
    return n && n > 0 ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
  }

  // ── covers ─────────────────────────────────────────────────────────────
  // Static fallback under the WebGL cover: the same five colours grok-fluid-covers.js seeds from the id
  // (FNV-1a → mulberry32 → HSL), so the card looks the same before the first frame or without WebGL2.
  var PRESET_COLORS = {
    grok47: ["#6E7480", "#10141A", "#2A3038", "#08090C", "#8A9098"],
    grok46: ["#2A3040", "#10151F", "#EDEDED", "#050508", "#2E2745"],
    grok45: ["#050505", "#000000", "#3A3A3A", "#0C0C0C", "#222222"],
  };
  var ID_PRESET = {
    "grok-4.7": "grok47", "grok-4.6": "grok46", "grok-4.6-free": "grok46", "grok-4.6-ide-auto": "grok46",
    "grok-4.5": "grok45", "grok-4.5-free": "grok45", "grok-4.5-xhigh": "grok45",
  };
  function hashId(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hslHex(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = ((((h % 360) + 360) % 360) / 60);
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var rgb = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    var m = l - c / 2;
    return "#" + rgb.map(function (v) {
      var n = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
      return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }
  function coverColors(id) {
    var key = lower(id);
    if (ID_PRESET[key]) return PRESET_COLORS[ID_PRESET[key]];
    var rnd = mulberry32(hashId("id:" + key));
    var hue = rnd() * 360;
    var shift = 16 + rnd() * 48;
    return [
      hslHex(hue, 0.1 + rnd() * 0.22, 0.22 + rnd() * 0.16),
      hslHex(hue, 0.12 + rnd() * 0.28, 0.05 + rnd() * 0.07),
      hslHex(hue + shift, 0.06 + rnd() * 0.16, 0.68 + rnd() * 0.2),
      hslHex(hue, 0.04 + rnd() * 0.1, 0.02 + rnd() * 0.04),
      hslHex(hue + shift * 0.45, 0.08 + rnd() * 0.22, 0.38 + rnd() * 0.22),
    ];
  }
  function coverStyle(id) {
    var c = coverColors(id);
    return (
      "background-color:" + c[1] + ";background-image:" +
      "radial-gradient(120% 90% at 18% 22%," + c[2] + " 0%,transparent 46%)," +
      "radial-gradient(90% 80% at 82% 78%," + c[4] + " 0%,transparent 60%)," +
      "linear-gradient(135deg," + c[0] + " 0%," + c[1] + " 55%," + c[3] + " 100%)"
    );
  }
  function syncCovers() {
    if (window.CancriGrokFluid && typeof window.CancriGrokFluid.sync === "function") window.CancriGrokFluid.sync();
  }

  // Big wordmark on the card art. OpenAI prints the codename ("Astra"); we drop the vendor word when what
  // is left still names the model ("Claude Opus 5.5" → "Opus 5.5"), otherwise keep the full name.
  function wordmark(name) {
    var s = String(name || "").trim();
    var i = s.indexOf(" ");
    if (i > 0) {
      var rest = s.slice(i + 1).trim();
      if (/^[A-Za-z]/.test(rest) && /\d/.test(rest)) return rest;
    }
    return s;
  }
  function wordmarkAttrs(text) {
    var len = 0;
    for (var i = 0; i < text.length; i++) len += text.charCodeAt(i) > 0x2e80 ? 2 : 1;
    return ' style="text-shadow:0 2px 12px rgb(0 0 0 / 60%);--wm-len:' + Math.max(len, 1) + '"' + (len > 12 ? ' data-wm="wrap"' : "");
  }

  // ── shared bits of markup ──────────────────────────────────────────────
  // Vendor logo before a model name. "filter" = a button the catalog handles (data-brand-filter);
  // "link" = goes to the catalog filtered to that vendor (detail and pricing pages).
  function brandLogo(m, mode) {
    var b = brandOf(m);
    var src = BRAND_ICON[b];
    if (!src) return "";
    var file = src.slice(src.lastIndexOf("/") + 1);
    var label = "只看 " + brandLabel(b) + " 的模型";
    var img = '<img src="' + escAttr(src) + '" alt="" width="16" height="16" loading="lazy" decoding="async"' + (MONO_ICON[file] ? " data-mono" : "") + ">";
    var attrs = ' class="models-brand-logo" title="' + escAttr(label) + '" aria-label="' + escAttr(label) + '"';
    if (mode === "link") return '<a href="/api/docs/models/?brand=' + encodeURIComponent(b) + '"' + attrs + ">" + img + "</a>";
    return '<button type="button" data-brand-filter="' + escAttr(b) + '"' + attrs + ">" + img + "</button>";
  }
  function badge(text, color) {
    return '<div class="_Badge_10t5o_1" data-color="' + (color || "secondary") + '" data-size="md" data-pill="" data-variant="soft">' + esc(text) + "</div>";
  }
  function copyButton(value, label) {
    return (
      '<button type="button" class="_Button_6dmow_1 models-copy" data-color="primary" data-variant="ghost" data-pill="" data-size="xs" data-icon-size="sm" data-copy="' +
      escAttr(value) + '" aria-label="' + escAttr(label) + '" title="' + escAttr(label) + '"><span class="_ButtonInner_6dmow_4">' +
      '<span class="block relative h-[var(--button-icon-size)] w-[var(--button-icon-size)]">' +
      ICON.copy("models-icon-copy h-full w-full") + ICON.check("models-icon-check h-full w-full") + "</span></span></button>"
    );
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      }
      ta.remove();
    });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-copy]");
    if (!btn) return;
    e.preventDefault();
    copyText(btn.getAttribute("data-copy")).then(function () {
      btn.setAttribute("data-copied", "");
      clearTimeout(btn.__copiedTimer);
      btn.__copiedTimer = setTimeout(function () {
        btn.removeAttribute("data-copied");
      }, 1500);
    }, function () {});
  });

  window.NexusModels = {
    BASE_URL: BASE_URL,
    load: load,
    loadHealth: loadHealth,
    healthRow: healthRow,
    bestHourly: bestHourly,
    uptimeHtml: uptimeHtml,
    modelId: modelId,
    variantOf: variantOf,
    isFree: isFree,
    priceOf: priceOf,
    priceText: priceText,
    cheapestMember: cheapestMember,
    description: description,
    errorText: errorText,
    brandLabel: brandLabel,
    brandOf: brandOf,
    brandLogo: brandLogo,
    yen: yen,
    yenFixed: yenFixed,
    compactTokens: compactTokens,
    groupDigits: groupDigits,
    detailUrl: detailUrl,
    coverStyle: coverStyle,
    syncCovers: syncCovers,
    wordmark: wordmark,
    wordmarkAttrs: wordmarkAttrs,
    badge: badge,
    copyButton: copyButton,
    esc: esc,
    escAttr: escAttr,
    icon: ICON,
  };
})();
