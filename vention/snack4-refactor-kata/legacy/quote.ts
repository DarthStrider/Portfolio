// FROZEN COPY of src/quote.ts as it was before refactoring. Do not edit.
// The golden-master test runs every generated case through this and through
// the current code, and requires identical results.

// quote.ts - machine quote calculator
// TODO: clean this up (2019)
// DO NOT TOUCH THE ROUNDING - finance relies on it

export var lastQuote: any = null;

var PLATES: any = { "PL-100": 18.5, "PL-200": 32, "PL-300": 54.25, "BR-90": 7.8 };

export function calculateQuote(design: any, customer: any) {
  var lines: any[] = [];
  var warnings: string[] = [];
  var subtotal = 0;
  var labor = 0;
  var weight = 0;
  var hours = 0;
  var hasMotion = false, hasController = false, hasActuator = false;
  var longest = 0;

  if (!design || !design.items || design.items.length == 0) {
    return { error: "Empty design" };
  }

  for (var i = 0; i < design.items.length; i++) {
    var it = design.items[i];
    if (it.type == "extrusion") {
      var len = it.length;
      if (len < 50) {
        warnings.push("Extrusion " + it.sku + " too short (" + len + "mm), skipped");
        continue;
      }
      var perM = 0;
      var kg = 0;
      if (it.profile == "20x20") {
        perM = 12.5;
        kg = 0.5;
      } else if (it.profile == "40x40") {
        perM = 28;
        kg = 1.5;
      } else if (it.profile == "40x80") {
        perM = 49;
        kg = 2.8;
      } else {
        warnings.push("Unknown profile " + it.profile + " for " + it.sku);
        continue;
      }
      var price = perM * (len / 1000) + 1.5;
      if (it.finish == "black") price = price * 1.15;
      if (len > 3000) {
        warnings.push("Extrusion " + it.sku + " exceeds 3000mm stock; will be spliced");
        price = price + 8 + 1.5;
      }
      price = Math.round(price * 100) / 100;
      var t = price * it.qty;
      lines.push({
        sku: it.sku,
        desc: it.profile + " extrusion " + len + "mm" + (it.finish == "black" ? " black" : ""),
        qty: it.qty,
        unit: price,
        total: t,
      });
      subtotal += t;
      weight += kg * (len / 1000) * it.qty;
      hours += 0.5 * it.qty;
      if (len > longest) longest = len;
    } else if (it.type == "plate") {
      var p = PLATES[it.sku];
      if (p == undefined) {
        warnings.push("Unknown plate " + it.sku);
        continue;
      }
      lines.push({ sku: it.sku, desc: "Plate " + it.sku, qty: it.qty, unit: p, total: p * it.qty });
      subtotal += p * it.qty;
      weight += 1.2 * it.qty;
      hours += 0.25 * it.qty;
    } else if (it.type == "fastener") {
      var packs = Math.round(it.qty / 50);
      if (packs == 0) packs = 1;
      lines.push({ sku: it.sku, desc: "Fasteners (pack of 50)", qty: packs, unit: 6.75, total: packs * 6.75 });
      subtotal += packs * 6.75;
      weight += 0.4 * packs;
    } else if (it.type == "motor" || it.type == "actuator") {
      hasMotion = true;
      var u = it.type == "motor" ? 189 : 420;
      if (it.type == "actuator") {
        hasActuator = true;
        if (it.qty >= 4) u = u * 0.95;
      }
      lines.push({
        sku: it.sku,
        desc: it.type == "motor" ? "Servo motor" : "Linear actuator",
        qty: it.qty,
        unit: u,
        total: u * it.qty,
      });
      subtotal += u * it.qty;
      weight += (it.type == "motor" ? 1.8 : 3.5) * it.qty;
      hours += 1 * it.qty;
    } else if (it.type == "controller") {
      hasController = true;
      lines.push({ sku: it.sku, desc: "Motion controller", qty: it.qty, unit: 650, total: 650 * it.qty });
      subtotal += 650 * it.qty;
      weight += 2.2 * it.qty;
      hours += 2 * it.qty;
    } else {
      warnings.push("Unknown item type " + it.type);
    }
  }

  if (hasMotion && !hasController) warnings.push("No controller in design");

  if (design.assembly) {
    if (hours < 2) hours = 2;
    labor = hours * 35;
    lines.push({ sku: "LAB", desc: "Assembly (" + hours + " h)", qty: 1, unit: labor, total: labor });
  }

  // discounts
  var disc = 0;
  var tierPct = 0;
  if (customer.tier == "partner") tierPct = 0.1;
  if (customer.tier == "enterprise") tierPct = 0.15;
  var tierDisc = subtotal * tierPct;
  var promoDisc = 0;
  if (customer.code == "SPRING10") promoDisc = (subtotal + labor) * 0.1;
  if (promoDisc > tierDisc) disc = promoDisc;
  else disc = tierDisc;
  if (customer.orders > 10) disc = disc + subtotal * 0.02;
  disc = Math.round(disc * 100) / 100;

  // shipping
  var rate = 0,
    min = 0;
  if (customer.region == "CA") {
    rate = 1.2;
    min = 25;
  } else if (customer.region == "US") {
    rate = 1.5;
    min = 30;
  } else if (customer.region == "EU") {
    rate = 2.4;
    min = 45;
  } else {
    rate = 3.9;
    min = 60;
  }
  var ship = weight * rate;
  if (ship < min) ship = min;
  if ((customer.region == "CA" || customer.region == "US") && subtotal >= 2500) ship = 0;
  if (customer.code == "FREESHIP") ship = 0;
  if (design.rush) ship = ship * 1.5;
  ship = Math.round(ship * 100) / 100;

  // tax
  var taxRate = 0;
  if (customer.region == "CA") {
    if (customer.province == "ON") taxRate = 0.13;
    else if (customer.province == "QC") taxRate = 0.14975;
    else if (customer.province == "BC") taxRate = 0.12;
    else if (customer.province == "AB") taxRate = 0.05;
    else taxRate = 0.05;
  } else if (customer.region == "EU") taxRate = 0.2;
  var taxable = subtotal + labor - disc + ship;
  var tax = Math.round(taxable * taxRate * 100) / 100;
  var total = Math.round((taxable + tax) * 100) / 100;

  // lead time
  var lead = 5;
  if (longest > 2000) lead += 3;
  if (hasActuator) lead += 7;
  if (design.assembly) lead += 2;
  if (design.rush) {
    lead = Math.ceil(lead / 2);
    if (lead < 2) lead = 2;
  }

  var q = {
    quoteId: "Q-" + Date.now(),
    lines: lines,
    subtotal: Math.round((subtotal + labor) * 100) / 100,
    discount: disc,
    shipping: ship,
    tax: tax,
    total: total,
    leadTimeDays: lead,
    warnings: warnings,
  };
  lastQuote = q;
  console.log("quote " + q.quoteId + " total " + total);
  return q;
}
