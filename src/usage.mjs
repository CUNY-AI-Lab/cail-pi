/** Format the gateway's account estimate; amounts are USD microdollars. */
export function formatUsageReport(result) {
  if (!result.ok) return { text: result.message, healthy: false };
  const q = result.quota;
  const invalid = { text: "CAIL usage unavailable. Try /usage again later.", healthy: false };
  const fields = ["limit", "estimated_used", "estimated_remaining", "used_percent", "remaining_percent", "window_seconds", "calculated_at"];
  if (!q || q.object !== "quota" || q.managed_by !== "cloudflare" || q.state !== "estimated" || q.unit !== "microdollar" || q.currency !== "USD" ||
      !fields.every((field) => Number.isSafeInteger(q[field]) && q[field] >= 0) || q.limit < 1 || q.window_seconds < 1 ||
      !["fixed", "sliding"].includes(q.window_technique)) return invalid;
  const percent = Math.min(100, Math.round(q.estimated_used / q.limit * 100));
  if (q.used_percent !== percent || q.remaining_percent !== 100 - percent || q.estimated_remaining !== Math.max(0, q.limit - q.estimated_used)) return invalid;
  const fixed = q.window_technique === "fixed";
  const start = fixed ? Math.floor(q.calculated_at / q.window_seconds) * q.window_seconds : q.calculated_at - q.window_seconds;
  const end = fixed ? start + q.window_seconds : q.calculated_at;
  const dates = [start, end, q.calculated_at].map((seconds) => new Date(seconds * 1000));
  if (dates.some((date) => !Number.isFinite(date.valueOf()))) return invalid;
  const [from, to, calculated] = dates.map((date) => date.toISOString().slice(0, date.getUTCSeconds() === 0 ? 16 : 19).replace("T", " ") + " UTC");
  const money = (amount) => amount > 0 && amount < 10000 ? "<$0.01" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 1000000);
  const row = (label, value) => `  ${label.padEnd(10)}${value}`;
  const duration = q.window_seconds % 86400 === 0 ? `${q.window_seconds / 86400} ${q.window_seconds === 86400 ? "day" : "days"}`
    : q.window_seconds % 3600 === 0 ? `${q.window_seconds / 3600} ${q.window_seconds === 3600 ? "hour" : "hours"}`
    : `${q.window_seconds} seconds`;
  return {
    healthy: true,
    text: [
      "CAIL account usage · estimate (USD)",
      "",
      row("Used", `${money(q.estimated_used)} of ${money(q.limit)} (${percent}%)`),
      row("Remaining", money(q.estimated_remaining)),
      "",
      ...(fixed ? [row("Since", from), row("Resets", to)] : [row("Window", `${duration} (rolling)`)]),
      row("As of", calculated),
      "",
      "Shared across your CAIL keys. Updates may lag.",
    ].join("\n"),
  };
}
