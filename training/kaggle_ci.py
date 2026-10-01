"""
Run the relief-model training on Kaggle from GitHub Actions, so no local PC is needed.

  python training/kaggle_ci.py check   -> who am I, weekly GPU quota left
  python training/kaggle_ci.py start   -> upload the notebook and run it on a Kaggle GPU
  python training/kaggle_ci.py status  -> queued / running / complete / error
  python training/kaggle_ci.py fetch   -> download results into training/results/ and public/models/

Needs the env var KAGGLE_API_TOKEN (stored as a GitHub secret). Messages are printed as
GitHub "notice"/"error" annotations so they can be read without opening the logs.
"""
import glob, json, os, shutil, sys, tempfile

from kaggle.api.kaggle_api_extended import KaggleApi

SLUG = "ai-carve-relief"
NOTEBOOK = "training/ai_carve_relief_kaggle.ipynb"
MODEL = "ai-carve-relief-v1"


LOG = os.environ.get("KAGGLE_CI_LOG", "kaggle-status.txt")


def _log(level, msg):
    print(f"::{level}::{msg}", flush=True)
    with open(LOG, "a") as f:
        f.write(f"[{level}] {msg}\n")


def note(msg):  _log("notice", msg)
def fail(msg):  _log("error", msg); sys.exit(1)


def main(action):
    api = KaggleApi()
    api.authenticate()
    user = api.get_config_value("username")
    if not user:
        fail("Kaggle key did not give a username: the key may be wrong or expired.")
    ref = f"{user}/{SLUG}"

    if action == "check":
        note(f"Kaggle user: {user}")
        try:
            q = api.quota_view()
            note(f"GPU quota: {q.gpu_quota}")
        except Exception as e:
            note(f"Could not read GPU quota: {e}")
        return

    if action == "start":
        d = tempfile.mkdtemp()
        shutil.copy(NOTEBOOK, os.path.join(d, "notebook.ipynb"))
        meta = {"id": ref, "title": "AI Carve relief", "code_file": "notebook.ipynb",
                "language": "python", "kernel_type": "notebook", "is_private": True,
                "enable_gpu": True, "enable_tpu": False, "enable_internet": True,
                "dataset_sources": [], "competition_sources": [], "kernel_sources": [], "model_sources": []}
        json.dump(meta, open(os.path.join(d, "kernel-metadata.json"), "w"))
        try:
            r = api.kernels_push(d)
        except Exception as e:
            fail(f"Push failed: {e}")
        err = getattr(r, "error", None)
        if err:
            fail(f"Kaggle refused: {err}")
        note(f"Started: {getattr(r, 'url', '') or 'https://www.kaggle.com/code/' + ref} (version {getattr(r, 'version_number', '?')})")
        return

    if action == "status":
        s = api.kernels_status(ref)
        msg = getattr(s, "failure_message", "") or ""
        st = str(getattr(s, "status", s))
        note(f"Status of {ref}: {st} {msg}".strip())
        state = "complete" if "COMPLETE" in st.upper() else (
            "error" if any(k in st.upper() for k in ("ERROR", "CANCEL")) else "running")
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write(f"state={state}\n")
        return

    if action == "fetch":
        out = tempfile.mkdtemp()
        token = None
        while True:
            files, token = api.kernels_output(ref, out, force=True, quiet=True, page_token=token)
            if not token:
                break
        res = "training/results"
        os.makedirs(res, exist_ok=True)
        for name in ("report.json", "compare.png"):
            hit = glob.glob(f"{out}/**/{name}", recursive=True)
            if hit:
                shutil.copy(hit[0], os.path.join(res, name))
        cfg = glob.glob(f"{out}/**/{MODEL}/config.json", recursive=True)
        if not os.path.exists(f"{res}/report.json"):
            fail("No report.json in the Kaggle output: the run is not finished or it failed.")
        rep = json.load(open(f"{res}/report.json"))
        note(f"original error {rep['original']['score']:.4f} · relief error {rep['fine_tuned']['score']:.4f} · "
             f"improvement {rep.get('improvement_pct')}% · improved={rep.get('improved')}")
        if cfg and rep.get("improved"):
            src = os.path.dirname(cfg[0])
            dst = f"public/models/{MODEL}"
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
            sizes = {os.path.relpath(p, dst): round(os.path.getsize(p) / 1e6, 1)
                     for p in glob.glob(f"{dst}/**/*", recursive=True) if os.path.isfile(p)}
            note(f"Model copied to {dst}: {sizes}")
        else:
            note("Model NOT copied (not better, or files missing). Results saved for review only.")
        return

    fail(f"Unknown action {action}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "check")
