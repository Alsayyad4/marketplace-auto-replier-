// node render.js [teaching2.js] > teaching-copy-paste.md — one fenced block per dashboard box, in dashboard order.
const t = require("./" + (process.argv[2] || "teaching.js"));
const boxes = [
  ["Business name", "businessName"],
  ["Address", "businessAddress"],
  ["Hours (text shown to Claude)", "businessHoursText"],
  ["Business info", "businessInfo"],
  ["Instructions / tone", "instructions"],
  ["Example conversations", "examples"],
  ["Closer goals", "closerGoals"],
  ["Price list", "priceList"],
  ["Visit-confirm message", "visitConfirmMessage"],
];
const out = [];
for (const [label, key] of boxes) {
  if (t[key] == null) continue; // a box the dashboard no longer has (the visit-confirm box left in v0.21.94)
  out.push("### " + label);
  out.push("");
  out.push("```text");
  out.push(String(t[key]).replace(/```/g, "'''"));
  out.push("```");
  out.push("");
}
process.stdout.write(out.join("\n"));
