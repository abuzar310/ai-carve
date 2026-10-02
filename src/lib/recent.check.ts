import { RECENT_MAX, addRecent, ago, parseRecent, recentTitle } from "./recent";
import { DEFAULT_SPEC } from "./textPanel";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

const plate = { ...DEFAULT_SPEC, template: "plate" as const, lines: ["محمد"], header: "" };
let list = addRecent([], plate, 1000);
ok(list.length === 1 && list[0]!.spec === plate, "first build is remembered");
list = addRecent(list, { ...plate, widthMm: 400 }, 2000);
ok(list.length === 2 && list[0]!.spec.widthMm === 400, "newest first");
list = addRecent(list, plate, 3000);
ok(list.length === 2 && list[0]!.at === 3000 && list[0]!.spec.widthMm === plate.widthMm, "building the same panel again moves it to the top, no duplicate");
for (let i = 0; i < 30; i++) list = addRecent(list, { ...plate, widthMm: 100 + i }, 4000 + i);
ok(list.length === RECENT_MAX, `keeps at most ${RECENT_MAX}`);

// survives storage, and damaged storage never breaks the page
const back = parseRecent(JSON.stringify(list));
ok(back.length === RECENT_MAX && back[0]!.spec.widthMm === list[0]!.spec.widthMm, "round trip through storage");
ok(parseRecent(null).length === 0 && parseRecent("not json").length === 0 && parseRecent('{"a":1}').length === 0, "missing or broken storage gives an empty list");
const odd = parseRecent(JSON.stringify([{ spec: { template: "spaceship", widthMm: -5 }, at: "x" }, null, 7]));
ok(odd.length === 1 && odd[0]!.spec.template === DEFAULT_SPEC.template && odd[0]!.at === 0, "odd entries are cleaned, not trusted");

ok(recentTitle(plate) === "محمد", "title: first line");
ok(recentTitle({ ...DEFAULT_SPEC, template: "names99" }) === "99 Names of Allah", "title: 99 Names");
ok(recentTitle({ ...DEFAULT_SPEC, template: "pattern", lines: [] }) === "Pattern panel", "title: pattern without text");
ok(recentTitle({ ...plate, lines: ["x".repeat(40)] }).length === 28, "long titles are shortened");
ok(ago(0, 30_000) === "just now" && ago(0, 5 * 60_000) === "5 min ago" && ago(0, 3 * 3_600_000) === "3 h ago" && ago(0, 86_400_000) === "yesterday" && ago(0, 3 * 86_400_000) === "3 days ago", "friendly times");
console.log(`carve recent.check OK (${n} assertions)`);
