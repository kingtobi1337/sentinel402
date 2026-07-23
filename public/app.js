const $ = selector => document.querySelector(selector);
const SVG_NS = "http://www.w3.org/2000/svg";

function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  const use = document.createElementNS(SVG_NS, "use");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const toolIcons = { identity: "fingerprint", flow: "flow", risk: "shield" };
const phaseIcons = { payment: "ledger", complete: "verify", evidence: "fingerprint", error: "shield", plan: "radar", request: "flow" };

const state = { health: null, catalog: null, run: null, pollTimer: null };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setError(message) {
  const box = $("#terminal-error");
  box.textContent = message;
  box.hidden = !message;
}

function renderHealth(health) {
  state.health = health;
  $("#network-label").textContent = `${health.network} · evidence mainnet`;
  const chip = $("#readiness-chip");
  chip.textContent = health.demoReady ? "buyer ready" : "buyer offline";
  chip.className = `live-chip ${health.demoReady ? "ready" : "offline"}`;
  $("#run-button").disabled = !health.demoReady;
}

function renderCatalog(catalog) {
  state.catalog = catalog;
  const grid = $("#tool-grid");
  grid.replaceChildren();
  catalog.tools.forEach((tool, index) => {
    const card = element("article", "tool-card");
    const id = element("div", "tool-id");
    id.append(element("span", "", `TOOL / 0${index + 1}`), element("span", "", "x402 exact"));
    const visual = element("div", "tool-icon-wrap");
    visual.append(icon(toolIcons[tool.id] || "radar", "tool-icon"));
    const title = element("h3", "", tool.name);
    const tagline = element("p", "tagline", tool.tagline);
    const description = element("p", "description", tool.description);
    const price = element("div", "price");
    const priceText = element("strong", "", `${tool.priceHbar} ℏ`);
    const unit = element("span", "", `${tool.priceTinybar} tinybar / result`);
    price.append(priceText, unit);
    card.append(id, visual, title, tagline, description, price);
    grid.append(card);
  });
}

function eventClass(event) {
  if (event.phase === "complete") return "complete";
  if (event.phase === "payment") return "payment";
  if (event.phase === "error") return "error";
  return event.phase;
}

function renderEvents(run) {
  const list = $("#event-list");
  list.replaceChildren();
  if (!run.events.length) {
    const li = element("li", "empty-state");
    const number = element("span", "", "00");
    const body = element("div");
    body.append(element("strong", "", "Run queued"), element("p", "", "The procurement engine is waking up."));
    li.append(icon("radar", "event-icon"), number, body);
    list.append(li);
    return;
  }
  run.events.forEach(event => {
    const li = element("li", eventClass(event));
    const number = element("span", "", String(event.sequence).padStart(2, "0"));
    const body = element("div");
    body.append(element("strong", "", event.title), element("p", "", event.detail));
    li.append(icon(phaseIcons[event.phase] || "radar", "event-icon"), number, body);
    list.append(li);
  });
}

function safeHashscan(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "hashscan.io" && parsed.pathname.startsWith("/testnet/transaction/") ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderReceipts(run) {
  const list = $("#receipt-list");
  list.replaceChildren();
  if (!run.receipts.length) {
    list.append(element("div", "receipt-empty", "No settlement yet. The agent will not accept protected evidence without one."));
    return;
  }
  run.receipts.forEach(receipt => {
    const href = safeHashscan(receipt.hashscanUrl);
    const card = element(href ? "a" : "div", "receipt-card");
    if (href) {
      card.href = href;
      card.target = "_blank";
      card.rel = "noreferrer";
    }
    card.append(
      element("span", "", `${receipt.toolId} / ${receipt.amountTinybar} tinybar`),
      element("strong", "", receipt.transaction),
      element("small", "", href ? "OPEN HASHSCAN ↗" : "INVALID RECEIPT URL"),
    );
    list.append(card);
  });
}

function renderVerdict(run) {
  const card = $("#verdict-card");
  if (!run.summary || run.status !== "completed") {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("#verdict-value").textContent = run.summary.verdict || "EVIDENCE READY";
  $("#verdict-detail").textContent = `${run.summary.purchasedTools} paid tools · ${run.summary.spentTinybar} tinybar settled`;
}

function renderRun(run) {
  state.run = run;
  $("#run-status").textContent = run.status.toUpperCase();
  $("#recorder-intro").textContent = `Run ${run.id.slice(0, 8)} · ${run.depth} dossier for ${run.accountId}`;
  renderEvents(run);
  renderReceipts(run);
  renderVerdict(run);
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.retryAfter = body.retryAfterSeconds;
    throw error;
  }
  return body;
}

async function pollRun(id) {
  clearTimeout(state.pollTimer);
  try {
    const run = await jsonRequest(`/api/runs/${encodeURIComponent(id)}`);
    renderRun(run);
    if (run.status === "queued" || run.status === "running") {
      state.pollTimer = setTimeout(() => pollRun(id), 900);
    } else {
      $("#run-button").disabled = !state.health?.demoReady;
      if (run.status === "failed") setError(run.error || "The autonomous run failed.");
    }
  } catch (error) {
    setError(error.message);
    $("#run-button").disabled = !state.health?.demoReady;
  }
}

$("#run-form").addEventListener("submit", async event => {
  event.preventDefault();
  setError("");
  const button = $("#run-button");
  button.disabled = true;
  button.firstChild.textContent = "Starting buyer… ";
  try {
    const run = await jsonRequest("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: $("#account").value.trim(), depth: $("#depth").value, budgetTinybar: $("#budget").value }),
    });
    renderRun(run);
    $("#recorder").scrollIntoView({ behavior: "smooth", block: "start" });
    await pollRun(run.id);
  } catch (error) {
    const suffix = error.retryAfter ? ` Try again in ${error.retryAfter}s.` : "";
    setError(`${error.message}${suffix}`);
    button.disabled = !state.health?.demoReady;
  } finally {
    button.firstChild.textContent = "Authorize autonomous run ";
  }
});

async function boot() {
  try {
    const [health, catalog] = await Promise.all([jsonRequest("/api/health"), jsonRequest("/api/catalog")]);
    renderHealth(health);
    renderCatalog(catalog);
  } catch (error) {
    setError(`Service discovery failed: ${error.message}`);
    $("#readiness-chip").textContent = "unreachable";
    $("#readiness-chip").className = "live-chip offline";
    $("#run-button").disabled = true;
  }
}

boot();
