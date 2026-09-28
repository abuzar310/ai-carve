# AI Carve relief model

AI Carve's depth comes from Depth Anything V2 Small, a model trained on ordinary photos. It guesses
*distance*, not *carving height*. This folder retrains that same model on carved reliefs so its output
looks like a relief (domed leaves, layered petals, crisp veins) instead of a photo depth map.

## What's here

| File | What it does |
| --- | --- |
| `relief_synth.py` | Invents carvings procedurally (leaves, flowers, scrolls, vines, beads, mouldings, chip carving, lettering, organic shapes) with their exact height maps, and renders them as photos (wood / stone / gilt / plaster, light + shadows + dirt in crevices, JPEG), flat artwork or line drawings. No downloaded images: no licence issues, unlimited data. `python relief_synth.py preview grid.png` shows samples. |
| `train_relief.py` | Fine-tunes `depth-anything/Depth-Anything-V2-Small-hf` (Apache-2.0), scores it against the original on held-out carvings, exports ONNX fp16 + q8 in the folder layout transformers.js loads. |
| `ai_carve_relief_kaggle.ipynb` | Both scripts in one notebook for a free Kaggle GPU. |
| `build_notebook.py` | Rebuilds the notebook after editing the scripts. |

## Train (free, no GPU of your own)

1. kaggle.com → **Create → New Notebook → File → Import Notebook** → `ai_carve_relief_kaggle.ipynb`.
2. Right panel: **Accelerator: GPU T4 x2** (or P100), **Internet: On** (phone-verified account).
3. **Save Version → Save & Run All (Commit)**. About 2–3 h in the background; the browser can be closed.
   Uses a few of Kaggle's ~30 free GPU hours per week.
4. Open the finished version → **Output** → download `out/ai-carve-relief-v1.zip`.
   The last cell says **READY TO SHIP** only if the new model beat the original on held-out carvings.

## Ship

Unzip into the repo so the files are at:

```
public/models/ai-carve-relief-v1/config.json
public/models/ai-carve-relief-v1/preprocessor_config.json
public/models/ai-carve-relief-v1/onnx/model_fp16.onnx
public/models/ai-carve-relief-v1/onnx/model_quantized.onnx
```

Commit and push. `src/lib/depth.ts` finds the model and uses it; if it's missing or fails to load, the
site falls back to the stock model as before. Compare on the live site with `?depth=general`.

Retraining later: change `--name` to `ai-carve-relief-v2` **and** `RELIEF_MODEL_ID` in
`src/lib/depthModel.ts`, so browsers don't keep the old cached files.

## Honest limits

- Trained only on synthetic carvings. It should be much better on carving photos and ornament art;
  on ordinary photos (people, pets) the original model may still do better. Check both with `?depth=general`.
- The next step up in quality is adding real scanned reliefs to the training data.
