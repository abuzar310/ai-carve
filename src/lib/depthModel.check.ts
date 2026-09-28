import { chooseDepthModel, RELIEF_MODEL_ID, reliefModelAvailable } from "./depthModel.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(chooseDepthModel("", true) === "relief", "relief model is the default when deployed");
ok(chooseDepthModel("", false) === "general", "general model when relief is not deployed");
ok(chooseDepthModel("?depth=general", true) === "general", "?depth=general forces the stock model");
ok(chooseDepthModel("?depth=relief", false) === "general", "?depth=relief can't use a missing model");
ok(chooseDepthModel("?x=1&depth=relief", true) === "relief", "?depth=relief with other params");

const res = (status: number, body: unknown) => async (url: string) => {
  seen = url;
  return {
    ok: status >= 200 && status < 300,
    json: async () => {
      if (typeof body === "string") throw new SyntaxError("not JSON");
      return body;
    },
  };
};
let seen = "";

(async () => {
  ok(await reliefModelAvailable(res(200, { model_type: "depth_anything" })), "real config → available");
  ok(seen === `/models/${RELIEF_MODEL_ID}/config.json`, `probes the versioned folder (${seen})`);
  ok(!(await reliefModelAvailable(res(404, { model_type: "depth_anything" }))), "404 → not available");
  ok(!(await reliefModelAvailable(res(200, "<!doctype html>"))), "dev-server index.html fallback → not available");
  ok(!(await reliefModelAvailable(res(200, { model_type: "vit" }))), "some other model → not available");
  ok(!(await reliefModelAvailable(async () => { throw new Error("offline"); })), "network error → not available");
  console.log(`carve depthModel.check OK (${n} assertions)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
