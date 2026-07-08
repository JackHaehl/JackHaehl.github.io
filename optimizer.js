(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EssentialWashingOptimizer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "April", "May", "June", "July", "August", "Sept", "Oct", "Nov", "Dec"];
  const N_MONTHS = 12;

  const DEFAULT_SEASONAL_SOILING = {
    Jan: 0.80, Feb: 0.90, Mar: 1.10, April: 1.25, May: 1.20, June: 1.15,
    July: 1.50, August: 1.60, Sept: 1.40, Oct: 1.00, Nov: 0.80, Dec: 0.75,
  };

  const DEFAULT_CONFIG = {
    dirty_floor: 0.12,
    soil_base: 0.06,
    soil_per_risk: 0.028,
    ppi_zero: 45.0,
    ppi_span: 55.0,
    ppi_gamma: 1.7,
    importance_min: 0.60,
    importance_range: 0.80,
    priority_penalty: 0.8,
    priority_gap: 10.0,
    priority_price_ratio: 1.75,
    min_coverage_ppi: 80.0,
    min_coverage_penalty: 50.0,
    visit_overhead: 0.0,
    time_limit_s: 30.0,
    utility_scale: 1000,
  };

  const TAG_DEFAULT_SOILING_RISK = [
    [["street", "retail", "entry"], 8.0],
    [["pool"], 8.0],
    [["courtyard", "gym"], 6.0],
    [["lobby", "lounge", "leasing", "amenity"], 5.0],
  ];

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function normalizedScore(value, defaultValue = 5.0) {
    const numeric = Number(value);
    return clamp(Number.isFinite(numeric) ? numeric : defaultValue, 0.0, 10.0) / 10.0;
  }

  function score010(value, defaultValue = 5.0) {
    const numeric = Number(value);
    return clamp(Number.isFinite(numeric) ? numeric : defaultValue, 0.0, 10.0);
  }

  function ppiFrequencyTier(ppiScore) {
    if (ppiScore >= 90) return { label: "Critical Signature Areas", target_cleanings: 12, min_spacing_months: 1 };
    if (ppiScore >= 80) return { label: "High Visibility Areas", target_cleanings: 6, min_spacing_months: 2 };
    if (ppiScore >= 70) return { label: "Moderate Visibility Areas", target_cleanings: 2, min_spacing_months: 5 };
    if (ppiScore >= 60) return { label: "Low Visibility Areas", target_cleanings: 1, min_spacing_months: 12 };
    return { label: "Minimal Presentation Impact", target_cleanings: 0, min_spacing_months: 12 };
  }

  function ppiTier(ppi) {
    if (ppi >= 90) return ["Critical Signature Areas", 12];
    if (ppi >= 80) return ["High Visibility Areas", 6];
    if (ppi >= 70) return ["Moderate Visibility Areas", 2];
    if (ppi >= 60) return ["Low Visibility Areas", 1];
    return ["Minimal Presentation Impact", 0];
  }

  function quoteTags(quote) {
    return new Set((quote.tags || []).map((tag) => String(tag).trim().toLowerCase()));
  }

  function hasAny(tags, values) {
    return values.some((value) => tags.has(value));
  }

  function monthLookup(inputData) {
    const months = Object.fromEntries(MONTHS.map((month) => [month, { month }]));
    for (const row of inputData.months || []) {
      const name = String(row.month || "").trim();
      if (months[name]) months[name] = { ...months[name], ...row };
    }
    return months;
  }

  function monthImportance(month, tags) {
    const leasing = normalizedScore(month.leasing_activity);
    const amenity = normalizedScore(month.amenity_usage);
    const event = normalizedScore(month.event_weight, 0.0);
    let weighted;
    if (hasAny(tags, ["leasing", "lobby", "entry", "street", "retail"])) {
      weighted = 0.70 * leasing + 0.20 * amenity + 0.10 * event;
    } else if (hasAny(tags, ["pool", "amenity", "courtyard", "gym", "lounge"])) {
      weighted = 0.25 * leasing + 0.65 * amenity + 0.10 * event;
    } else {
      weighted = 0.50 * leasing + 0.40 * amenity + 0.10 * event;
    }
    return 0.75 + weighted;
  }

  function presentationValue(quote, month, monthsSinceLastCleaning = null) {
    const tags = quoteTags(quote);
    const ppi = normalizedScore(quote.ppi_score, 70.0);
    const efficiency = normalizedScore(quote.service_efficiency_score);
    const tier = ppiFrequencyTier(Number(quote.ppi_score || 0));
    const recencyMultiplier = monthsSinceLastCleaning == null
      ? 1.0
      : Math.max(0.25, Math.min(1.75, monthsSinceLastCleaning / tier.min_spacing_months));
    const efficiencyMultiplier = 0.85 + 0.30 * efficiency;
    return 100.0 * ppi * monthImportance(month, tags) * recencyMultiplier * efficiencyMultiplier;
  }

  function combinations(items, count, start = 0, prefix = [], out = []) {
    if (prefix.length === count) {
      out.push(prefix.slice());
      return out;
    }
    for (let i = start; i <= items.length - (count - prefix.length); i += 1) {
      prefix.push(items[i]);
      combinations(items, count, i + 1, prefix, out);
      prefix.pop();
    }
    return out;
  }

  function spacingIsValid(monthIndexes, minSpacing) {
    if (monthIndexes.length <= 1 || minSpacing <= 1) return true;
    for (let i = 0; i < monthIndexes.length - 1; i += 1) {
      if (monthIndexes[i + 1] - monthIndexes[i] < minSpacing) return false;
    }
    return true;
  }

  function spacingScore(monthIndexes) {
    if (monthIndexes.length <= 1) return 0.0;
    const gaps = [];
    for (let i = 0; i < monthIndexes.length - 1; i += 1) gaps.push(monthIndexes[i + 1] - monthIndexes[i]);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const variance = gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / gaps.length;
    return -variance;
  }

  function bestIdealMonths(quote, months) {
    const tier = ppiFrequencyTier(Number(quote.ppi_score || 0));
    const target = Math.max(0, Math.min(12, Number.parseInt(quote.ideal_cleanings ?? tier.target_cleanings, 10)));
    if (target === 0) return [];
    if (target === 12) return MONTHS.slice();

    const indexes = Array.from({ length: 12 }, (_, index) => index);
    let bestIndexes = null;
    let bestScore = -Infinity;
    for (const combo of combinations(indexes, target)) {
      if (!spacingIsValid(combo, tier.min_spacing_months)) continue;
      const score = combo.reduce((sum, index) => sum + presentationValue(quote, months[MONTHS[index]]), 0)
        + spacingScore(combo) * 5.0;
      if (score > bestScore) {
        bestScore = score;
        bestIndexes = combo;
      }
    }
    if (bestIndexes == null) {
      const ranked = indexes.slice().sort((a, b) => presentationValue(quote, months[MONTHS[b]]) - presentationValue(quote, months[MONTHS[a]]));
      bestIndexes = ranked.slice(0, target).sort((a, b) => a - b);
    }
    return bestIndexes.map((index) => MONTHS[index]);
  }

  function roundMoneyMap(values) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value, 2)]));
  }

  function summarizeCurrentPlan(planType, rows, monthlyTotals, monthlyBillbacks) {
    const operatingTotal = Object.values(monthlyTotals).reduce((sum, value) => sum + value, 0);
    const billBackTotal = Object.values(monthlyBillbacks).reduce((sum, value) => sum + value, 0);
    return {
      plan_type: planType,
      rows,
      monthly_operating_totals: roundMoneyMap(monthlyTotals),
      monthly_bill_back_totals: roundMoneyMap(monthlyBillbacks),
      annual_operating_total: round(operatingTotal, 2),
      annual_bill_back_total: round(billBackTotal, 2),
      annual_gross_total: round(operatingTotal + billBackTotal, 2),
    };
  }

  function buildIdealPlan(inputData) {
    const months = monthLookup(inputData);
    const rows = [];
    const monthlyTotals = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));
    const monthlyBillbacks = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));

    for (const quote of inputData.quotes || []) {
      const selectedMonths = bestIdealMonths(quote, months);
      const price = Number(quote.price || 0);
      const billBack = Boolean(quote.bill_back || false);
      const tier = ppiFrequencyTier(Number(quote.ppi_score || 0));
      const values = Object.fromEntries(selectedMonths.map((month) => [month, price]));
      for (const month of selectedMonths) {
        if (billBack) monthlyBillbacks[month] += price;
        else monthlyTotals[month] += price;
      }
      rows.push({
        name: quote.name,
        price,
        ppi_score: quote.ppi_score,
        service_efficiency_score: quote.service_efficiency_score,
        priority: tier.label,
        recommended_cleanings: tier.target_cleanings,
        scheduled_cleanings: selectedMonths.length,
        months: selectedMonths,
        annual_spend: price * selectedMonths.length,
        bill_back: billBack,
        values,
      });
    }
    return summarizeCurrentPlan("ideal", rows, monthlyTotals, monthlyBillbacks);
  }

  function monthsSinceLast(selectedIndexes, currentIndex) {
    const previous = selectedIndexes.filter((index) => index < currentIndex);
    if (!previous.length) return null;
    return currentIndex - Math.max(...previous);
  }

  function spacingForCleaningCount(cleaningCount) {
    if (cleaningCount <= 1) return 12;
    if (cleaningCount === 2) return 5;
    if (cleaningCount === 3) return 3;
    if (cleaningCount <= 6) return 2;
    return 1;
  }

  function bestNextMonthIndex(quote, months, selectedIndexes) {
    const nextCount = selectedIndexes.length + 1;
    const minSpacing = spacingForCleaningCount(nextCount);
    const remaining = Array.from({ length: 12 }, (_, index) => index).filter((index) => !selectedIndexes.includes(index));
    let validRemaining = remaining.filter((index) => selectedIndexes.every((selected) => Math.abs(index - selected) >= minSpacing));
    if (!validRemaining.length) validRemaining = remaining;
    if (!validRemaining.length) return null;
    let bestIndex = validRemaining[0];
    let bestScore = -Infinity;
    for (const index of validRemaining) {
      const indexes = selectedIndexes.concat([index]).sort((a, b) => a - b);
      const score = presentationValue(quote, months[MONTHS[index]]) + spacingScore(indexes) * 5.0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  function priorityRounds(maxCleanings) {
    const rounds = [];
    for (let cleaningNumber = 1; cleaningNumber <= maxCleanings; cleaningNumber += 1) {
      if (cleaningNumber === 1) rounds.push([90, cleaningNumber], [80, cleaningNumber]);
      else if (cleaningNumber === 2) rounds.push([90, cleaningNumber], [80, cleaningNumber]);
      else if (cleaningNumber === 3) rounds.push([95, cleaningNumber], [90, cleaningNumber], [80, cleaningNumber]);
      else if (cleaningNumber <= 6) rounds.push([95, cleaningNumber], [90, cleaningNumber], [80, cleaningNumber]);
      else rounds.push([95, cleaningNumber], [90, cleaningNumber]);
    }
    rounds.push([70, 1], [60, 1], [0, 1]);
    return rounds;
  }

  function buildBudgetConstrainedPlan(inputData) {
    const months = monthLookup(inputData);
    const annualBudget = Number(inputData.annual_budget || 0);
    const monthlyCaps = Object.fromEntries(MONTHS.map((month) => [month, Number(months[month].budget_cap ?? annualBudget)]));
    const monthlyTotals = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));
    const monthlyBillbacks = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));
    const selected = Object.fromEntries((inputData.quotes || []).map((quote) => [String(quote.name), []]));
    const selectedValue = new Map();
    let operatingTotal = 0.0;
    const idealMonthsByQuote = {};
    const maxCleaningsByQuote = {};

    for (const quote of inputData.quotes || []) {
      const quoteName = String(quote.name);
      const tier = ppiFrequencyTier(Number(quote.ppi_score || 0));
      const idealMonths = bestIdealMonths(quote, months);
      idealMonthsByQuote[quoteName] = idealMonths;
      maxCleaningsByQuote[quoteName] = Number.parseInt(
        quote.max_cleanings ?? quote.ideal_cleanings ?? (idealMonths.length || tier.target_cleanings),
        10,
      );
    }

    function canPlace(quote, monthIndex) {
      const monthName = MONTHS[monthIndex];
      const quoteName = String(quote.name);
      const billBack = Boolean(quote.bill_back || false);
      const price = Number(quote.price || 0);
      if (selected[quoteName].includes(monthIndex)) return false;
      if (selected[quoteName].length >= maxCleaningsByQuote[quoteName]) return false;
      if (!billBack && operatingTotal + price > annualBudget) return false;
      if (!billBack && monthlyTotals[monthName] + price > monthlyCaps[monthName]) return false;
      return true;
    }

    function place(quote, monthIndex) {
      const quoteName = String(quote.name);
      const monthName = MONTHS[monthIndex];
      const price = Number(quote.price || 0);
      const billBack = Boolean(quote.bill_back || false);
      const recency = monthsSinceLast(selected[quoteName], monthIndex);
      const adjustedValue = presentationValue(quote, months[monthName], recency);
      selected[quoteName].push(monthIndex);
      selectedValue.set(`${quoteName}\u0000${monthIndex}`, adjustedValue);
      if (billBack) monthlyBillbacks[monthName] += price;
      else {
        monthlyTotals[monthName] += price;
        operatingTotal += price;
      }
    }

    function quoteSortKey(quote, monthIndex) {
      const ppiScore = Number(quote.ppi_score || 0);
      const price = Math.max(0.01, Number(quote.price || 0));
      const value = monthIndex == null ? 0.0 : presentationValue(quote, months[MONTHS[monthIndex]]);
      return [ppiScore, value, value / price, -price];
    }

    const quotesByPpi = (inputData.quotes || []).slice().sort((a, b) => Number(b.ppi_score || 0) - Number(a.ppi_score || 0));
    for (const quote of quotesByPpi) {
      if (!Boolean(quote.bill_back || false)) continue;
      const quoteName = String(quote.name);
      for (const monthName of idealMonthsByQuote[quoteName].slice(0, maxCleaningsByQuote[quoteName])) {
        const monthIndex = MONTHS.indexOf(monthName);
        if (canPlace(quote, monthIndex)) place(quote, monthIndex);
      }
    }

    const maxRoundCount = Math.max(0, ...Object.values(maxCleaningsByQuote));
    for (const [ppiFloor, cleaningNumber] of priorityRounds(maxRoundCount)) {
      const roundCandidates = [];
      for (const quote of quotesByPpi) {
        if (Boolean(quote.bill_back || false)) continue;
        const quoteName = String(quote.name);
        if (Number(quote.ppi_score || 0) < ppiFloor) continue;
        if (selected[quoteName].length !== cleaningNumber - 1) continue;
        if (maxCleaningsByQuote[quoteName] < cleaningNumber) continue;
        const monthIndex = bestNextMonthIndex(quote, months, selected[quoteName]);
        if (monthIndex == null || !canPlace(quote, monthIndex)) continue;
        roundCandidates.push([quote, monthIndex]);
      }
      roundCandidates.sort((left, right) => compareTuple(quoteSortKey(right[0], right[1]), quoteSortKey(left[0], left[1])));
      for (const [quote, monthIndex] of roundCandidates) {
        const quoteName = String(quote.name);
        if (selected[quoteName].length !== cleaningNumber - 1) continue;
        if (canPlace(quote, monthIndex)) place(quote, monthIndex);
      }
    }

    const rows = [];
    for (const quote of inputData.quotes || []) {
      const quoteName = String(quote.name);
      const price = Number(quote.price || 0);
      const billBack = Boolean(quote.bill_back || false);
      const tier = ppiFrequencyTier(Number(quote.ppi_score || 0));
      const selectedMonths = selected[quoteName].slice().sort((a, b) => a - b).map((index) => MONTHS[index]);
      rows.push({
        name: quote.name,
        price,
        ppi_score: quote.ppi_score,
        service_efficiency_score: quote.service_efficiency_score,
        priority: tier.label,
        recommended_cleanings: tier.target_cleanings,
        scheduled_cleanings: selectedMonths.length,
        months: selectedMonths,
        annual_spend: price * selectedMonths.length,
        bill_back: billBack,
        values: Object.fromEntries(selectedMonths.map((month) => [month, price])),
        presentation_value: selectedMonths.reduce((sum, month) => sum + (selectedValue.get(`${quoteName}\u0000${MONTHS.indexOf(month)}`) || 0.0), 0.0),
      });
    }

    return summarizeCurrentPlan("budget_constrained", rows, monthlyTotals, monthlyBillbacks);
  }

  function compareTuple(left, right) {
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      if (left[i] < right[i]) return -1;
      if (left[i] > right[i]) return 1;
    }
    return left.length - right.length;
  }

  function defaultSoilingRisk(tags) {
    for (const [tagSet, risk] of TAG_DEFAULT_SOILING_RISK) {
      if (tagSet.some((tag) => tags.has(tag))) return risk;
    }
    return 5.0;
  }

  function decayMonthImportance(monthData, tags, cfg) {
    const leasing = score010(monthData.leasing_activity) / 10.0;
    const amenity = score010(monthData.amenity_usage) / 10.0;
    const event = score010(monthData.event_weight, 0.0) / 10.0;
    let weighted;
    if (hasAny(tags, ["leasing", "lobby", "entry", "street", "retail"])) {
      weighted = 0.70 * leasing + 0.20 * amenity + 0.10 * event;
    } else if (hasAny(tags, ["pool", "amenity", "courtyard", "gym", "lounge"])) {
      weighted = 0.25 * leasing + 0.65 * amenity + 0.10 * event;
    } else {
      weighted = 0.50 * leasing + 0.40 * amenity + 0.10 * event;
    }
    return cfg.importance_min + cfg.importance_range * weighted;
  }

  function visibilityWeight(ppi, cfg) {
    const base = clamp((ppi - cfg.ppi_zero) / cfg.ppi_span, 0.0, 1.0);
    return base ** cfg.ppi_gamma;
  }

  function buildDecayProblem(data) {
    const cfg = { ...DEFAULT_CONFIG, ...(data.config || {}) };
    if (Object.prototype.hasOwnProperty.call(data, "visit_overhead")) cfg.visit_overhead = Number(data.visit_overhead);
    const monthRows = Object.fromEntries(MONTHS.map((month) => [month, { month }]));
    for (const row of data.months || []) {
      const name = String(row.month || "").trim();
      if (monthRows[name]) monthRows[name] = { ...monthRows[name], ...row };
    }
    const soilMult = MONTHS.map((month) => Number(monthRows[month].soiling_multiplier ?? DEFAULT_SEASONAL_SOILING[month]));
    const annualBudget = Number(data.annual_budget || 0.0);
    const monthlyCaps = MONTHS.map((month) => Number(monthRows[month].budget_cap ?? (annualBudget || Infinity)));
    const areas = [];
    for (const quote of data.quotes || []) {
      const tags = quoteTags(quote);
      const ppi = Number(quote.ppi_score || 0.0);
      const [, tierTarget] = ppiTier(ppi);
      const idealCount = Math.max(0, Math.min(N_MONTHS, Number.parseInt(quote.ideal_cleanings ?? tierTarget, 10)));
      const maxCount = Math.max(0, Math.min(N_MONTHS, Number.parseInt(quote.max_cleanings ?? idealCount, 10)));
      const risk = Number(quote.soiling_risk ?? defaultSoilingRisk(tags));
      const area = {
        name: String(quote.name),
        price: Number(quote.price || 0.0),
        ppi,
        tags,
        bill_back: Boolean(quote.bill_back || false),
        ideal_count: idealCount,
        max_count: maxCount,
        soiling_risk: clamp(risk, 1.0, 10.0),
        utility: [],
        month_weight: [],
      };
      const weight = visibilityWeight(ppi, cfg);
      area.month_weight = MONTHS.map((month) => weight * decayMonthImportance(monthRows[month], tags, cfg));
      const baseRate = cfg.soil_base + cfg.soil_per_risk * area.soiling_risk;
      const rate = soilMult.map((mult) => clamp(baseRate * mult, 0.0, 0.9));
      const floor = cfg.dirty_floor;
      area.utility = Array.from({ length: N_MONTHS }, () => Array(N_MONTHS).fill(0.0));
      for (let c = 0; c < N_MONTHS; c += 1) {
        let cleanliness = 1.0;
        for (let step = 0; step < N_MONTHS; step += 1) {
          const m = (c + step) % N_MONTHS;
          if (step > 0) cleanliness = Math.max(floor, cleanliness * (1.0 - rate[m]));
          area.utility[c][m] = area.month_weight[m] * (cleanliness - floor);
        }
      }
      areas.push(area);
    }
    return { areas, annual_budget: annualBudget, monthly_caps: monthlyCaps, config: cfg, customer: data.customer };
  }

  function areaScheduleUtility(area, cleaned) {
    if (!cleaned.size) return 0.0;
    let total = 0.0;
    for (let m = 0; m < N_MONTHS; m += 1) {
      let best = -Infinity;
      for (const c of cleaned) best = Math.max(best, area.utility[c][m]);
      total += best;
    }
    return total;
  }

  function priorityPenaltyTotal(problem, counts) {
    const cfg = problem.config;
    let penalty = 0.0;
    const ops = problem.areas.filter((area) => !area.bill_back);
    for (const hi of ops) {
      for (const lo of ops) {
        if (hi.ppi < lo.ppi + cfg.priority_gap) continue;
        if (lo.price > 0 && hi.price / Math.max(lo.price, 0.01) > cfg.priority_price_ratio) continue;
        const inversion = (counts[lo.name] || 0) - (counts[hi.name] || 0);
        if (inversion > 0) penalty += cfg.priority_penalty * inversion;
      }
    }
    return penalty;
  }

  function solveDecayGreedy(problem, mode) {
    const cfg = problem.config;
    const schedule = Object.fromEntries(problem.areas.map((area) => [area.name, new Set()]));
    function marginal(area, month) {
      const current = areaScheduleUtility(area, schedule[area.name]);
      const addedSet = new Set(schedule[area.name]);
      addedSet.add(month);
      return areaScheduleUtility(area, addedSet) - current;
    }
    if (mode === "ideal") {
      for (const area of problem.areas) {
        while (schedule[area.name].size < area.ideal_count) {
          let bestMonth = null;
          let bestGain = -Infinity;
          for (let m = 0; m < N_MONTHS; m += 1) {
            if (schedule[area.name].has(m)) continue;
            const gain = marginal(area, m);
            if (gain > bestGain) {
              bestGain = gain;
              bestMonth = m;
            }
          }
          schedule[area.name].add(bestMonth);
        }
      }
      return schedule;
    }

    for (const area of problem.areas) {
      if (!area.bill_back) continue;
      while (schedule[area.name].size < area.ideal_count) {
        let bestMonth = null;
        let bestGain = -Infinity;
        for (let m = 0; m < N_MONTHS; m += 1) {
          if (schedule[area.name].has(m)) continue;
          const gain = marginal(area, m);
          if (gain > bestGain) {
            bestGain = gain;
            bestMonth = m;
          }
        }
        schedule[area.name].add(bestMonth);
      }
    }

    const overhead = cfg.visit_overhead;
    let spent = 0.0;
    const monthlySpend = Array(N_MONTHS).fill(0.0);
    const activeMonth = Array(N_MONTHS).fill(false);
    const candidateCost = (area, month) => area.price + (!activeMonth[month] && overhead > 0 ? overhead : 0.0);

    const sortedAreas = problem.areas.slice().sort((a, b) => b.ppi - a.ppi);
    for (const area of sortedAreas) {
      if (area.bill_back || area.ppi < cfg.min_coverage_ppi || area.ideal_count < 1 || area.max_count < 1) continue;
      const candidates = [];
      for (let m = 0; m < N_MONTHS; m += 1) {
        const cost = candidateCost(area, m);
        if ((problem.annual_budget <= 0 || spent + cost <= problem.annual_budget)
          && monthlySpend[m] + cost <= problem.monthly_caps[m]) {
          candidates.push(m);
        }
      }
      if (!candidates.length) continue;
      let bestMonth = candidates[0];
      let bestGain = -Infinity;
      for (const m of candidates) {
        const gain = marginal(area, m);
        if (gain > bestGain) {
          bestGain = gain;
          bestMonth = m;
        }
      }
      const cost = candidateCost(area, bestMonth);
      schedule[area.name].add(bestMonth);
      spent += cost;
      monthlySpend[bestMonth] += cost;
      activeMonth[bestMonth] = true;
    }

    while (true) {
      let best = null;
      let bestRatio = 0.0;
      for (const area of problem.areas) {
        if (area.bill_back) continue;
        const chosen = schedule[area.name];
        if (chosen.size >= area.max_count) continue;
        for (let m = 0; m < N_MONTHS; m += 1) {
          if (chosen.has(m)) continue;
          const cost = candidateCost(area, m);
          if (problem.annual_budget > 0 && spent + cost > problem.annual_budget) continue;
          if (monthlySpend[m] + cost > problem.monthly_caps[m]) continue;
          let gain = marginal(area, m);
          const counts = Object.fromEntries(Object.entries(schedule).map(([name, set]) => [name, set.size]));
          const currentPenalty = priorityPenaltyTotal(problem, counts);
          counts[area.name] += 1;
          gain -= priorityPenaltyTotal(problem, counts) - currentPenalty;
          const ratio = gain / Math.max(cost, 0.01);
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = [area, m, cost];
          }
        }
      }
      if (best == null || bestRatio <= 0.0) break;
      const [area, month, cost] = best;
      schedule[area.name].add(month);
      spent += cost;
      monthlySpend[month] += cost;
      activeMonth[month] = true;
    }
    return schedule;
  }

  function cleaningMarginalValues(area, cleaned) {
    const total = areaScheduleUtility(area, cleaned);
    const result = {};
    for (const c of cleaned) {
      const without = new Set(cleaned);
      without.delete(c);
      result[c] = total - areaScheduleUtility(area, without);
    }
    return result;
  }

  function summarizeDecayPlan(problem, planType, schedule) {
    const monthlyOperating = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));
    const monthlyBillback = Object.fromEntries(MONTHS.map((month) => [month, 0.0]));
    const rows = [];
    for (const area of problem.areas) {
      const cleaned = schedule[area.name] || new Set();
      const sortedCleaned = Array.from(cleaned).sort((a, b) => a - b);
      const monthsNamed = sortedCleaned.map((m) => MONTHS[m]);
      const [tierLabel, tierTarget] = ppiTier(area.ppi);
      const marginals = cleaningMarginalValues(area, cleaned);
      for (const m of cleaned) {
        if (area.bill_back) monthlyBillback[MONTHS[m]] += area.price;
        else monthlyOperating[MONTHS[m]] += area.price;
      }
      rows.push({
        name: area.name,
        price: area.price,
        ppi_score: area.ppi,
        soiling_risk: area.soiling_risk,
        priority: tierLabel,
        recommended_cleanings: tierTarget,
        scheduled_cleanings: cleaned.size,
        months: monthsNamed,
        annual_spend: round(area.price * cleaned.size, 2),
        bill_back: area.bill_back,
        values: Object.fromEntries(sortedCleaned.map((m) => [MONTHS[m], area.price])),
        presentation_utility: round(areaScheduleUtility(area, cleaned), 4),
        marginal_utility_by_month: Object.fromEntries(sortedCleaned.map((m) => [MONTHS[m], round(marginals[m], 4)])),
        service_efficiency_score: null,
      });
    }
    const operatingTotal = Object.values(monthlyOperating).reduce((sum, value) => sum + value, 0);
    const billbackTotal = Object.values(monthlyBillback).reduce((sum, value) => sum + value, 0);
    const counts = Object.fromEntries(problem.areas.map((area) => [area.name, (schedule[area.name] || new Set()).size]));
    return {
      plan_type: planType,
      rows,
      monthly_operating_totals: roundMoneyMap(monthlyOperating),
      monthly_bill_back_totals: roundMoneyMap(monthlyBillback),
      annual_operating_total: round(operatingTotal, 2),
      annual_bill_back_total: round(billbackTotal, 2),
      annual_gross_total: round(operatingTotal + billbackTotal, 2),
      total_presentation_utility: round(rows.reduce((sum, row) => sum + row.presentation_utility, 0), 4),
      priority_inversion_penalty: round(priorityPenaltyTotal(problem, counts), 4),
    };
  }

  function normalizeDecayPlan(plan) {
    for (const row of plan.rows || []) {
      if (!Object.prototype.hasOwnProperty.call(row, "service_efficiency_score")) row.service_efficiency_score = null;
    }
    return plan;
  }

  function buildResult(inputData, budget = null) {
    const working = JSON.parse(JSON.stringify(inputData));
    if (budget !== null && budget !== undefined && budget !== "") working.annual_budget = Number(budget);
    const ideal = buildIdealPlan(working);
    const constrained = buildBudgetConstrainedPlan(working);
    const decayProblem = buildDecayProblem(working);
    const decayIdeal = normalizeDecayPlan(summarizeDecayPlan(decayProblem, "ideal", solveDecayGreedy(decayProblem, "ideal")));
    const decayConstrained = normalizeDecayPlan(summarizeDecayPlan(decayProblem, "budget_constrained", solveDecayGreedy(decayProblem, "constrained")));
    return {
      customer: working.customer,
      annual_budget: working.annual_budget,
      months: working.months || [],
      quotes: working.quotes || [],
      ideal,
      budget_constrained: constrained,
      decay_ideal: decayIdeal,
      decay_budget_constrained: decayConstrained,
      optimizers: {
        current: {
          name: "Current priority-preserving optimizer",
          description: "Allocates frequency in PPI-preserving rounds, then places cleanings in the strongest months.",
        },
        decay: {
          name: "Decay-based optimizer",
          description: "Models cleanliness decay through the year and chooses cleanings by presentation utility retained.",
          solver: "greedy",
        },
      },
      difference: {
        operating_budget_gap: round(ideal.annual_operating_total - constrained.annual_operating_total, 2),
        cleaning_count_gap: ideal.rows.reduce((sum, row) => sum + row.scheduled_cleanings, 0)
          - constrained.rows.reduce((sum, row) => sum + row.scheduled_cleanings, 0),
      },
    };
  }

  return {
    MONTHS,
    buildIdealPlan,
    buildBudgetConstrainedPlan,
    buildDecayProblem,
    solveDecayGreedy,
    summarizeDecayPlan,
    buildResult,
  };
});
