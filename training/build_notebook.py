"""Builds ai_carve_relief_kaggle.ipynb with relief_synth.py and train_relief.py embedded."""
import json, os

here = os.path.dirname(os.path.abspath(__file__))
synth = open(os.path.join(here, "relief_synth.py")).read()
train = open(os.path.join(here, "train_relief.py")).read()

def md(src): return {"cell_type": "markdown", "metadata": {}, "source": src}
def code(src): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src}

cells = [
md("""# AI Carve relief model: train on a free Kaggle GPU

Teaches Depth Anything V2 Small (the model AI Carve already runs in the browser) what carved reliefs look like,
using thousands of synthetic carvings with exact height maps. No data to upload.

**Settings (right-hand panel) before running:**
1. *Accelerator* → **GPU T4 x2** or **GPU P100**
2. *Internet* → **On** (needs a phone-verified Kaggle account)

**Then:** click **Save Version → Save & Run All (Commit)**. It runs in the background (about 2–3 hours);
you can close the browser. When it finishes, open the version → **Output** → download
`out/ai-carve-relief-v1.zip`.

**Install on the site:** unzip into the repo so you get `public/models/ai-carve-relief-v1/…`, commit, push.
The site switches to the relief model automatically (`?depth=general` in the URL shows the old model for comparison).
"""),
code("""!nvidia-smi -L || echo "NO GPU: turn on the GPU accelerator in Settings"
!pip install -q onnx onnxruntime onnxscript onnxconverter-common "transformers>=4.50"
import os; print("CPUs:", os.cpu_count())"""),
code("%%writefile relief_synth.py\n" + synth),
code("%%writefile train_relief.py\n" + train),
md("## 1. Quick self-test (~2 min)\nRuns the whole pipeline on a tiny random model so any setup problem shows up now, not after hours."),
code("""!rm -rf /tmp/smoke /tmp/smoke_out
!python -c "import relief_synth as r; r.write_dataset('/tmp/smoke', 24, n=160)"
!python train_relief.py --data /tmp/smoke --out /tmp/smoke_out --init tiny --steps 10 --bs 4 --size 126 --val 4 --eval-every 10 --lr-enc 3e-4 --lr-dec 1e-3 --freeze-blocks 0 --name smoke --workers 2
assert os.path.exists("/tmp/smoke_out/smoke.zip"), "self-test failed: see the error above"
print("SELF-TEST PASSED")"""),
md("## 2. Make the training carvings (~20–40 min on CPU)"),
code("""import time, numpy as np
from PIL import Image
import relief_synth as r
t = time.time()
r.write_dataset("/tmp/data", 12000, n=518)
print(f"done in {(time.time()-t)/60:.1f} min")
r_tiles = []
for s in range(4):
    img = np.asarray(Image.open(f"/tmp/data/{s:06d}.jpg"))
    h = np.asarray(Image.open(f"/tmp/data/{s:06d}.png"), np.float32) / 65535
    r_tiles.append(np.concatenate([img, np.repeat((h*255).astype(np.uint8)[..., None], 3, -1)], 1))
display(Image.fromarray(np.concatenate(r_tiles, 0)).resize((518, 1036)))"""),
md("## 3. Fine-tune, compare with the original model, export for the browser (~1–2 h)"),
code("""!python train_relief.py --data /tmp/data --out /kaggle/working/out --steps 8000 --bs 8"""),
md("## 4. Result\nColumns: picture · true height · original model · AI Carve relief model."),
code("""import json
from IPython.display import Image as Show, display
rep = json.load(open("/kaggle/working/out/report.json"))
print("original model error :", round(rep["original"]["score"], 4))
print("relief model error   :", round(rep["fine_tuned"]["score"], 4))
print("improvement          :", rep["improvement_pct"], "%")
print("files (MB)           :", {k: v for k, v in rep["export"].items() if k.endswith("_MB")})
print()
print("READY TO SHIP: download out/ai-carve-relief-v1.zip" if rep["improved"] else "NOT BETTER than the original: don't ship this one")
display(Show("/kaggle/working/out/compare.png"))"""),
]
nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
      "language_info": {"name": "python"}, "kaggle": {"accelerator": "gpu", "isInternetEnabled": True}},
      "nbformat": 4, "nbformat_minor": 5}
# notebook sources as line lists
for c in nb["cells"]:
    c["source"] = c["source"].splitlines(keepends=True)
json.dump(nb, open(os.path.join(here, "ai_carve_relief_kaggle.ipynb"), "w"), indent=1)
print("wrote ai_carve_relief_kaggle.ipynb")
