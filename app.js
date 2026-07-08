const MONTHS = ["Jan", "Feb", "Mar", "April", "May", "June", "July", "August", "Sept", "Oct", "Nov", "Dec"];
const STATIC_PLAN_FILES = [
  "sample_canyon_luxury_towers_plan.json",
  "sample_desert_garden_villas_plan.json",
  "sample_modera_plan.json",
  "sample_sonoran_resort_flats_plan.json",
  "sample_suburban_courtyard_commons_plan.json",
  "sample_urban_row_mixed_use_plan.json",
];

let selectedFile = null;
let selectedPlan = null;
let useStaticOptimizer = false;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const el = {
  fileList: document.querySelector("#fileList"),
  customerName: document.querySelector("#customerName"),
  budgetForm: document.querySelector("#budgetForm"),
  budgetInput: document.querySelector("#budgetInput"),
  emptyState: document.querySelector("#emptyState"),
  planView: document.querySelector("#planView"),
  quoteCount: document.querySelector("#quoteCount"),
  originalBudget: document.querySelector("#originalBudget"),
  idealTotal: document.querySelector("#idealTotal"),
  optimizedTotal: document.querySelector("#optimizedTotal"),
  decayOptimizedTotal: document.querySelector("#decayOptimizedTotal"),
  monthSummary: document.querySelector("#monthSummary"),
  quoteSummary: document.querySelector("#quoteSummary"),
  idealTable: document.querySelector("#idealTable"),
  optimizedTable: document.querySelector("#optimizedTable"),
  decayOptimizedTable: document.querySelector("#decayOptimizedTable"),
  idealMeta: document.querySelector("#idealMeta"),
  optimizedMeta: document.querySelector("#optimizedMeta"),
  decayOptimizedMeta: document.querySelector("#decayOptimizedMeta"),
};

async function loadFiles() {
  const data = await loadFileIndex();
  el.fileList.innerHTML = "";

  data.files.forEach((file) => {
    const button = document.createElement("button");
    button.className = "file-button";
    button.type = "button";
    button.dataset.file = file.file;
    button.innerHTML = `
      <span class="file-title">${escapeHtml(file.customer)}</span>
      <span class="file-meta">${file.quote_count} quotes · ${currency.format(file.annual_budget)}</span>
    `;
    button.addEventListener("click", () => selectFile(file.file));
    el.fileList.append(button);
  });

  if (data.files.length) {
    selectFile(data.files[0].file);
  }
}

async function selectFile(file) {
  selectedFile = file;
  document.querySelectorAll(".file-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.file === file);
  });

  selectedPlan = await loadPlan(file);
  el.customerName.textContent = selectedPlan.customer || file;
  el.budgetInput.value = Number(selectedPlan.annual_budget || 0).toFixed(2);
  renderInputs(selectedPlan);
  await generateQuote();
}

function renderInputs(plan) {
  el.emptyState.classList.add("hidden");
  el.planView.classList.remove("hidden");
  el.quoteCount.textContent = plan.quotes.length;
  el.originalBudget.textContent = currency.format(plan.annual_budget || 0);

  el.monthSummary.innerHTML = `
    <div class="month-grid">
      ${plan.months
        .map(
          (month) => `
          <div class="month-card">
            <p class="month-name">${escapeHtml(month.month)}</p>
            <div class="scale-row"><span>Leasing</span><strong>${score(month.leasing_activity)}</strong></div>
            <div class="scale-row"><span>Amenity</span><strong>${score(month.amenity_usage)}</strong></div>
          </div>
        `,
        )
        .join("")}
    </div>
  `;

  el.quoteSummary.innerHTML = plan.quotes
    .map(
      (quote) => `
      <div class="quote-card">
        <p class="quote-name">${escapeHtml(quote.name)}</p>
        <div class="quote-detail">
          <span>${currency.format(quote.price || 0)}</span>
          <span>PPI ${score(quote.ppi_score)} · SE ${score(quote.service_efficiency_score)}</span>
        </div>
        <p class="tags">${quote.bill_back ? "Bill back · " : ""}${(quote.tags || []).map(escapeHtml).join(", ")}</p>
      </div>
    `,
    )
    .join("");
}

async function generateQuote() {
  if (!selectedFile) return;
  const button = el.budgetForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Generating...";

  const result = await optimizeSelectedPlan();
  renderGenerated(result);
  button.disabled = false;
  button.textContent = "Generate Quote";
}

async function loadFileIndex() {
  if (!isLikelyStaticPage()) {
    try {
      const response = await fetch("/api/files");
      if (response.ok) return response.json();
    } catch (_error) {
      useStaticOptimizer = true;
    }
  }

  useStaticOptimizer = true;
  const files = [];
  for (const file of STATIC_PLAN_FILES) {
    const plan = await fetchStaticPlan(file);
    files.push({
      file,
      customer: plan.customer || file,
      annual_budget: plan.annual_budget || 0,
      quote_count: (plan.quotes || []).length,
    });
  }
  return { files };
}

async function loadPlan(file) {
  if (!useStaticOptimizer) {
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(file)}`);
      if (response.ok) return response.json();
    } catch (_error) {
      useStaticOptimizer = true;
    }
  }
  return fetchStaticPlan(file);
}

async function optimizeSelectedPlan() {
  if (!useStaticOptimizer) {
    try {
      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: selectedFile,
          annual_budget: el.budgetInput.value,
        }),
      });
      if (response.ok) return response.json();
    } catch (_error) {
      useStaticOptimizer = true;
    }
  }

  if (!window.EssentialWashingOptimizer) {
    throw new Error("Static optimizer module did not load.");
  }
  return window.EssentialWashingOptimizer.buildResult(selectedPlan, el.budgetInput.value);
}

async function fetchStaticPlan(file) {
  const candidates = [
    `data/${encodeURIComponent(file)}`,
    `../data/${encodeURIComponent(file)}`,
  ];
  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (response.ok) return response.json();
    } catch (_error) {
      // Try the next relative path.
    }
  }
  throw new Error(`Unable to load ${file}`);
}

function isLikelyStaticPage() {
  return window.location.protocol === "file:" || !["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function renderGenerated(result) {
  el.idealTotal.textContent = currency.format(result.ideal.annual_operating_total);
  el.optimizedTotal.textContent = currency.format(result.budget_constrained.annual_operating_total);
  el.decayOptimizedTotal.textContent = currency.format(result.decay_budget_constrained.annual_operating_total);
  el.idealMeta.textContent = `Operating ${currency.format(result.ideal.annual_operating_total)} · Bill back ${currency.format(result.ideal.annual_bill_back_total)}`;
  el.optimizedMeta.textContent = `Operating ${currency.format(result.budget_constrained.annual_operating_total)} · Budget ${currency.format(result.annual_budget)}`;
  el.decayOptimizedMeta.textContent = [
    `Operating ${currency.format(result.decay_budget_constrained.annual_operating_total)}`,
    `Budget ${currency.format(result.annual_budget)}`,
    `Utility ${score(result.decay_budget_constrained.total_presentation_utility)}`,
  ].join(" · ");

  el.idealTable.innerHTML = buildSpreadsheetTable(result.months, result.ideal, { scoreColumn: "SE" });
  el.optimizedTable.innerHTML = buildSpreadsheetTable(result.months, result.budget_constrained, { scoreColumn: "SE" });
  el.decayOptimizedTable.innerHTML = buildSpreadsheetTable(result.months, result.decay_budget_constrained, {
    scoreColumn: "Soiling",
  });
}

function buildSpreadsheetTable(months, plan, options = {}) {
  const scoreColumn = options.scoreColumn || "SE";
  const monthMap = Object.fromEntries(months.map((month) => [month.month, month]));
  const leasingCells = MONTHS.map((month) => {
    const value = score(monthMap[month]?.leasing_activity);
    return `<th class="lease-${value}">${leasingLabel(value)}</th>`;
  }).join("");
  const amenityCells = MONTHS.map((month) => {
    const value = score(monthMap[month]?.amenity_usage);
    const className = value >= 8 ? `amenity-${value}` : value >= 7 ? "amenity-7" : "amenity-low";
    return `<th class="${className}">${amenityLabel(value)}</th>`;
  }).join("");

  const rows = plan.rows
    .map((row) => {
      const monthCells = MONTHS.map((month) => {
        const value = row.values[month];
        const className = value ? (row.bill_back ? "wash-cell bill-back-cell" : "wash-cell") : "";
        return `<td class="money ${className}">${value ? currency.format(value) : ""}</td>`;
      }).join("");
      return `
        <tr>
          <td class="service-col">${escapeHtml(row.name)}${row.bill_back ? " <strong>(Bill Back)</strong>" : ""}</td>
          <td class="money">${currency.format(row.price)}</td>
          <td class="number">${score(row.ppi_score)}</td>
          <td class="number">${secondaryScore(row, scoreColumn)}</td>
          ${monthCells}
          <td class="money">${currency.format(row.annual_spend)}</td>
        </tr>
      `;
    })
    .join("");

  const operatingTotalRow = MONTHS.map(
    (month) => `<td class="money">${currency.format(plan.monthly_operating_totals[month] || 0)}</td>`,
  ).join("");
  const billBackTotalRow = MONTHS.map(
    (month) => `<td class="money">${currency.format(plan.monthly_bill_back_totals[month] || 0)}</td>`,
  ).join("");

  return `
    <table>
      <thead>
        <tr class="priority-row">
          <th class="service-col" colspan="4">Leasing Activity</th>
          ${leasingCells}
          <th>Total</th>
        </tr>
        <tr class="priority-row">
          <th class="service-col" colspan="4">Highest Amenity Usage</th>
          ${amenityCells}
          <th></th>
        </tr>
        <tr>
          <th class="service-col">Service Area</th>
          <th>Pricing</th>
          <th>PPI<br>Score</th>
          <th>${escapeHtml(scoreColumn)}<br>Score</th>
          ${MONTHS.map((month) => `<th>${month}</th>`).join("")}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="totals-row">
          <td class="service-col">Operating Totals</td>
          <td></td>
          <td></td>
          <td></td>
          ${operatingTotalRow}
          <td class="money">${currency.format(plan.annual_operating_total)}</td>
        </tr>
        <tr class="totals-row">
          <td class="service-col">Bill Back Totals</td>
          <td></td>
          <td></td>
          <td></td>
          ${billBackTotalRow}
          <td class="money">${currency.format(plan.annual_bill_back_total)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function secondaryScore(row, scoreColumn) {
  if (scoreColumn === "Soiling") return score(row.soiling_risk);
  return row.service_efficiency_score == null ? "" : score(row.service_efficiency_score);
}

function leasingLabel(value) {
  if (value >= 10) return "Peak Lease Season";
  if (value >= 8) return "Busy Season";
  if (value >= 6) return "Busy But Slowing";
  if (value >= 4) return "Moderate Activity";
  return "Slowest Period";
}

function amenityLabel(value) {
  if (value >= 8) return "Highest Amenity Usage";
  if (value >= 6) return "High Amenity Usage";
  if (value >= 4) return "Moderate Amenity Usage";
  return "Low Amenity Usage";
}

function score(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? number : number.toFixed(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

el.budgetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  generateQuote();
});

loadFiles().catch((error) => {
  el.emptyState.textContent = `Unable to load plan files: ${error.message}`;
});
