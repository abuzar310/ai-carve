import { readFileSync } from "node:fs";
import { buildPrompt, parseAiReply, type Candidate } from "./aiPick.ts";
import type { QuranIndex } from "./quranSearch.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const index = JSON.parse(readFileSync(new URL("../../public/data/quran.json", import.meta.url), "utf8")) as QuranIndex;
const cands: Candidate[] = [
  { id: 0, label: "Al-Afuww", source: "99 Names", arabic: "العفو", kind: "name" },
  { id: 1, label: "inna lillahi wa inna ilayhi rajiAAoona", source: "Quran 2:156 (words 6–10)", arabic: "إِنَّا لِلَّهِ وَإِنَّآ إِلَيۡهِ رَٰجِعُونَ", kind: "quran" },
  { id: 2, label: "Mashallah", source: "Phrase", arabic: "ما شاء الله", kind: "phrase" },
];

// the prompt carries the query and the candidates, and asks for ids / references only
const p = buildPrompt("inna lilahi wa ina ilaihi rajeoon", cands);
ok(p.includes("inna lilahi wa ina ilaihi rajeoon"), "prompt has the query");
ok(p.includes("[1] inna lillahi") && p.includes("[2] Mashallah"), "prompt lists candidates with ids");
ok(/never write arabic/i.test(p) && /json/i.test(p), "prompt forbids writing Arabic and asks for JSON");
ok(buildPrompt("x".repeat(5000), cands).length < 4000, "very long queries are cut");

// only real candidates and real references survive; the Arabic always comes from the library
let r = parseAiReply('{"ids":[1,99,-1,"2"],"refs":["2:153","999:1","2:9999","112:1-4"]}', cands, index);
ok(r.length === 3, `1 candidate + 2 valid refs (${r.length})`);
ok(r[0]!.arabic === cands[1]!.arabic && r[0]!.ai === true && r[0]!.source.startsWith("AI pick"), "candidate 1 comes back with its library Arabic, marked AI");
ok(r.some((h) => h.source.includes("2:153")) && r.some((h) => h.source.includes("112:1-4")), "valid references are looked up in the library");
ok(!r.some((h) => h.source.includes("999") || h.source.includes("9999")), "made-up references are dropped");
ok(r.every((h) => h.kind !== "note" && h.arabic.length > 0), "explanations for bad references never become results");
r = parseAiReply('```json\n{"ids":[0],"refs":[]}\n```', cands, index);
ok(r.length === 1 && r[0]!.arabic === "العفو", "accepts a reply wrapped in a code fence");
ok(parseAiReply("Sure! The answer is بصير", cands, index).length === 0, "free text (even Arabic) is ignored");
ok(parseAiReply('{"ids":[0],"arabic":"المتكير"}', cands, index).every((h) => h.arabic !== "المتكير"), "Arabic written by the AI is never used");
ok(parseAiReply("", cands, index).length === 0 && parseAiReply("{}", cands, index).length === 0, "empty replies give nothing");
r = parseAiReply('{"ids":[0,0,0],"refs":["2:153","2:153"]}', cands, index);
ok(r.length === 2, "duplicates removed");

console.log(`carve aiPick.check OK (${n} assertions)`);

// the server keeps its own copy of the prompt (api/ files are compiled alone): it must not drift
import { buildPrompt as serverPrompt } from "../../api/find.ts";
ok(serverPrompt("ya latif", cands) === buildPrompt("ya latif", cands), "server prompt = browser prompt");
ok(serverPrompt("x".repeat(400), []) === buildPrompt("x".repeat(400), []), "server prompt = browser prompt (long, empty)");
console.log(`carve aiPick.check server prompt OK (${n} assertions)`);

// ---- the endpoint, with Google's API replaced by a stand-in
import handler from "../../api/find.ts";
type Out = { status: number; body: any };
async function call(method: string, body?: unknown): Promise<Out> {
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(b?: string) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null }); } };
    void handler({ method, body, headers: {} }, res);
  });
}
const realFetch = globalThis.fetch;
{
  delete process.env.GEMINI_API_KEY;
  let o = await call("GET");
  ok(o.status === 200 && o.body.enabled === false, "no key → smart search off");
  o = await call("POST", { q: "x", candidates: [] });
  ok(o.status === 503, "no key → POST refused");
  process.env.GEMINI_API_KEY = "test-key";
  o = await call("GET");
  ok(o.body.enabled === true, "key set → smart search on");
  let sent: any = null;
  globalThis.fetch = (async (url: string, init: any) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ids":[1],"refs":["2:156"]}' }] } }] }), { status: 200 });
  }) as typeof fetch;
  o = await call("POST", JSON.stringify({ q: "inna lilahi wa ina ilaihi rajeoon", candidates: cands }));
  ok(o.status === 200 && o.body.text.includes('"ids":[1]'), "model reply is passed back");
  ok(sent.headers["x-goog-api-key"] === "test-key" && !String(sent.url).includes("test-key"), "key sent in a header, not the URL");
  ok(sent.body.contents[0].parts[0].text.includes("inna lilahi wa ina ilaihi rajeoon") && !JSON.stringify(sent.body).includes("إِنَّا"), "only English goes to the model");
  ok(parseAiReply(o.body.text, cands, index).length === 2, "reply validates into library hits");
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })) as typeof fetch;
  o = await call("POST", { q: "abc", candidates: [] });
  ok(o.status === 502 && o.body.error === "API key not valid", "Google errors are reported");
  o = await call("POST", { q: "y".repeat(301), candidates: [] });
  ok(o.status === 400, "over-long query refused");
  o = await call("PUT");
  ok(o.status === 405, "other methods refused");
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
}
console.log(`carve aiPick.check endpoint OK (${n} assertions)`);
