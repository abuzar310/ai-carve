"""
Fine-tune Depth Anything V2 Small into a relief model for AI Carve, evaluate it against the
original model, and export it in the layout transformers.js loads:

    <out>/<name>/config.json
    <out>/<name>/preprocessor_config.json
    <out>/<name>/onnx/model_fp16.onnx       (WebGPU path in depth.ts)
    <out>/<name>/onnx/model_quantized.onnx  (WASM "q8" path in depth.ts)

<name> defaults to ai-carve-relief-v1 = RELIEF_MODEL_ID in src/lib/depthModel.ts.
Copy that folder to public/models/ and the site uses it automatically.

Usage (Kaggle / Colab GPU):
    python train_relief.py --data /kaggle/working/data --out /kaggle/working/out

Local smoke test without downloads (random tiny model, CPU):
    python train_relief.py --data data --out out --init tiny --steps 3 --bs 2 --size 126 --val 4
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import shutil
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
BASE_ID = "depth-anything/Depth-Anything-V2-Small-hf"  # Apache-2.0 (Base/Large are non-commercial)


# ----------------------------------------------------------------------------- data
class Pairs(torch.utils.data.Dataset):
    def __init__(self, files: list[str], size: int, train: bool):
        self.files, self.size, self.train = files, size, train

    def __len__(self):
        return len(self.files)

    def __getitem__(self, i):
        stem = self.files[i]
        img = Image.open(stem + ".jpg").convert("RGB")
        h = np.asarray(Image.open(stem + ".png"), np.float32) / 65535.0
        img = torch.from_numpy(np.asarray(img, np.float32) / 255.0).permute(2, 0, 1)
        h = torch.from_numpy(h)[None]
        if self.train:
            # random resized crop (zoom in on detail) + flips + 90° turns + colour jitter
            n = img.shape[-1]
            s = random.uniform(0.45, 1.0)
            c = max(28, int(n * s))
            y, x = random.randint(0, n - c), random.randint(0, n - c)
            img, h = img[:, y:y + c, x:x + c], h[:, y:y + c, x:x + c]
            if random.random() < 0.5:
                img, h = img.flip(-1), h.flip(-1)
            k = random.randint(0, 3)
            img, h = torch.rot90(img, k, (1, 2)), torch.rot90(h, k, (1, 2))
            img = img * random.uniform(0.75, 1.25) + random.uniform(-0.08, 0.08)
            if random.random() < 0.15:
                img = img.mean(0, keepdim=True).expand(3, -1, -1)  # greyscale photos
            img = img.clamp(0, 1)
        img = F.interpolate(img[None], (self.size, self.size), mode="bilinear", align_corners=False, antialias=True)[0]
        h = F.interpolate(h[None], (self.size, self.size), mode="bilinear", align_corners=False, antialias=True)[0]
        return (img - MEAN) / STD, h


def split_files(data: str, n_val: int):
    stems = sorted(p[:-4] for p in glob.glob(os.path.join(data, "*.jpg")) if os.path.exists(p[:-4] + ".png"))
    if len(stems) <= n_val:
        raise SystemExit(f"need more than {n_val} samples in {data}, found {len(stems)}")
    return stems[:-n_val], stems[-n_val:]


# ----------------------------------------------------------------------------- loss / metrics
def norm_ssi(d: torch.Tensor) -> torch.Tensor:
    """Scale/shift normalisation per image (MiDaS): keeps the sign, so 'up' stays up."""
    b = d.shape[0]
    flat = d.reshape(b, -1)
    med = flat.median(1, keepdim=True).values
    mad = (flat - med).abs().mean(1, keepdim=True).clamp_min(1e-6)
    return ((flat - med) / mad).reshape_as(d)


def grad_loss(diff: torch.Tensor, scales: int = 4) -> torch.Tensor:
    tot = 0.0
    for s in range(scales):
        d = diff[:, :, :: 2 ** s, :: 2 ** s]
        tot = tot + (d[..., :, 1:] - d[..., :, :-1]).abs().mean() + (d[..., 1:, :] - d[..., :-1, :]).abs().mean()
    return tot / scales


def relief_loss(pred: torch.Tensor, gt: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    p, g = norm_ssi(pred), norm_ssi(gt)
    l1 = (p - g).abs().mean()
    gl = grad_loss(p - g)
    return l1 + 0.5 * gl, l1, gl


def predict(model, x: torch.Tensor) -> torch.Tensor:
    out = model(pixel_values=x).predicted_depth
    if out.dim() == 3:
        out = out[:, None]
    if out.shape[-2:] != x.shape[-2:]:
        out = F.interpolate(out, x.shape[-2:], mode="bilinear", align_corners=False)
    return out.float()


@torch.no_grad()
def evaluate(model, loader, device, amp) -> dict:
    model.eval()
    n, s_l1, s_gl = 0, 0.0, 0.0
    for x, h in loader:
        x, h = x.to(device), h.to(device)
        with torch.autocast(device.type, dtype=torch.float16, enabled=amp):
            p = predict(model, x)
        _, l1, gl = relief_loss(p, h)
        s_l1 += l1.item() * x.shape[0]
        s_gl += gl.item() * x.shape[0]
        n += x.shape[0]
    model.train()
    return {"ssi_l1": s_l1 / n, "grad": s_gl / n, "score": (s_l1 + 0.5 * s_gl) / n}


# ----------------------------------------------------------------------------- model
def load_model(init: str):
    from transformers import AutoModelForDepthEstimation, DepthAnythingConfig, Dinov2Config, DepthAnythingForDepthEstimation

    if init != "tiny":
        return AutoModelForDepthEstimation.from_pretrained(init)
    # Random, tiny, same architecture: lets the whole pipeline be tested offline.
    bb = Dinov2Config(hidden_size=64, num_hidden_layers=4, num_attention_heads=2, intermediate_size=128,
                      patch_size=14, image_size=126, out_indices=[1, 2, 3, 4], reshape_hidden_states=False,
                      layerscale_value=1.0)
    cfg = DepthAnythingConfig(backbone_config=bb, reassemble_hidden_size=64, neck_hidden_sizes=[16, 32, 48, 64],
                              fusion_hidden_size=16, head_hidden_size=8, depth_estimation_type="relative")
    m = DepthAnythingForDepthEstimation(cfg)
    torch.manual_seed(0)
    for mod in m.modules():  # deterministic init so base and trainee start identical
        if isinstance(mod, torch.nn.Conv2d):
            torch.nn.init.kaiming_normal_(mod.weight)
    m.head.conv3.bias.data.fill_(1.0)  # keep the final ReLU alive in the random test model
    return m


def save_processor(init: str, dst: str):
    from transformers import AutoImageProcessor, DPTImageProcessor

    try:
        proc = AutoImageProcessor.from_pretrained(init) if init != "tiny" else None
    except Exception:
        proc = None
    if proc is None:
        proc = DPTImageProcessor(do_resize=True, size={"height": 518, "width": 518}, keep_aspect_ratio=True,
                                 ensure_multiple_of=14, resample=3, do_rescale=True, rescale_factor=1 / 255,
                                 do_normalize=True, image_mean=[0.485, 0.456, 0.406], image_std=[0.229, 0.224, 0.225],
                                 do_pad=False)
    proc.save_pretrained(dst)


def freeze(model, blocks: int):
    """Keep the lowest encoder layers as they are: they hold general image knowledge."""
    bb = model.backbone
    for p in bb.embeddings.parameters():
        p.requires_grad = False
    for layer in bb.encoder.layer[:blocks]:
        for p in layer.parameters():
            p.requires_grad = False


# ----------------------------------------------------------------------------- export
class Wrap(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, pixel_values):
        return self.m(pixel_values=pixel_values).predicted_depth


def _dynamic_head_forward(self, hidden_states, patch_height, patch_width):
    """Same maths as DepthAnythingDepthEstimationHead.forward, minus the int() that freezes the
    output size during ONNX export (non-square pictures would otherwise come out square)."""
    x = hidden_states[self.head_in_index]
    x = self.conv1(x)
    x = F.interpolate(x, (patch_height * self.patch_size, patch_width * self.patch_size),
                      mode="bilinear", align_corners=True)
    x = self.activation1(self.conv2(x))
    x = self.activation2(self.conv3(x)) * getattr(self, "max_depth", 1)
    return x.squeeze(dim=1)


def export_onnx(model, dst_dir: str, size: int) -> dict:
    import types

    import onnx
    import onnxruntime as ort
    from onnxconverter_common import float16
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from torch.export import Dim

    os.makedirs(os.path.join(dst_dir, "onnx"), exist_ok=True)
    fp32 = os.path.join(dst_dir, "onnx", "model.onnx")
    model = model.float().cpu().eval()
    model.head.forward = types.MethodType(_dynamic_head_forward, model.head)
    # Trace with a NON-square picture that is not the native size, so the exporter keeps the
    # general code paths (position-embedding interpolation, output resize) instead of a shortcut.
    x = torch.randn(1, 3, size, size - 14)
    H, W = Dim("h", min=2, max=256), Dim("w", min=2, max=256)
    kw = dict(input_names=["pixel_values"], output_names=["predicted_depth"],
              dynamic_shapes={"pixel_values": {0: Dim("batch_size", min=1, max=16), 2: 14 * H, 3: 14 * W}},
              opset_version=18, dynamo=True)
    try:
        torch.onnx.export(Wrap(model), (x,), fp32, external_data=False, **kw)
    except TypeError:  # older PyTorch without the external_data option
        torch.onnx.export(Wrap(model), (x,), fp32, **kw)
    onnx.checker.check_model(fp32)

    report = {}
    # Check the ONNX graph matches PyTorch at the export size and at a non-square size.
    sess = ort.InferenceSession(fp32, providers=["CPUExecutionProvider"])
    for hw in [(size, size), (size, size * 3 // 4 // 14 * 14), (size // 2 // 14 * 14, size)]:
        t = torch.randn(1, 3, *hw)
        with torch.no_grad():
            ref = Wrap(model)(t).numpy()
        got = sess.run(None, {"pixel_values": t.numpy()})[0]
        if got.shape != ref.shape:
            raise RuntimeError(f"ONNX output {got.shape} != PyTorch {ref.shape} for input {hw}")
        report[f"fp32_maxdiff_{hw[0]}x{hw[1]}"] = float(np.abs(ref - got).max() / (np.abs(ref).max() + 1e-6))

    m16 = float16.convert_float_to_float16(onnx.load(fp32), keep_io_types=True)
    onnx.save(m16, os.path.join(dst_dir, "onnx", "model_fp16.onnx"))
    q8 = os.path.join(dst_dir, "onnx", "model_quantized.onnx")
    quantize_dynamic(fp32, q8, weight_type=QuantType.QUInt8, op_types_to_quantize=["MatMul", "Gemm"])
    t = torch.randn(1, 3, size, size)
    with torch.no_grad():
        ref = Wrap(model)(t).numpy()
    got = ort.InferenceSession(q8, providers=["CPUExecutionProvider"]).run(None, {"pixel_values": t.numpy()})[0]
    report["q8_corr"] = float(np.corrcoef(ref.ravel(), got.ravel())[0, 1])
    for f in ("model.onnx", "model_fp16.onnx", "model_quantized.onnx"):
        report[f + "_MB"] = round(os.path.getsize(os.path.join(dst_dir, "onnx", f)) / 1e6, 1)
    os.remove(fp32)  # the app only uses fp16 (WebGPU) and q8 (WASM); keep the repo small
    return report


# ----------------------------------------------------------------------------- preview
@torch.no_grad()
def comparison_grid(base, tuned, files, size, device, path, k=8):
    rows = []
    ds = Pairs(files[:k], size, train=False)
    for i in range(len(ds)):
        x, h = ds[i]
        xb = x[None].to(device)
        cols = [((x * STD + MEAN).clamp(0, 1).permute(1, 2, 0).numpy() * 255).astype(np.uint8)]
        for d in (h[0].numpy(), predict(base, xb)[0, 0].cpu().numpy(), predict(tuned, xb)[0, 0].cpu().numpy()):
            d = (d - d.min()) / (np.ptp(d) + 1e-6)
            cols.append(np.repeat((d * 255).astype(np.uint8)[..., None], 3, -1))
        rows.append(np.concatenate(cols, 1))
    Image.fromarray(np.concatenate(rows, 0)).save(path)


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--init", default=BASE_ID)
    ap.add_argument("--steps", type=int, default=8000)
    ap.add_argument("--bs", type=int, default=8)
    ap.add_argument("--size", type=int, default=518)
    ap.add_argument("--val", type=int, default=300)
    ap.add_argument("--lr-enc", type=float, default=5e-6)
    ap.add_argument("--lr-dec", type=float, default=5e-5)
    ap.add_argument("--freeze-blocks", type=int, default=4)
    ap.add_argument("--eval-every", type=int, default=1000)
    ap.add_argument("--name", default="ai-carve-relief-v1", help="must match RELIEF_MODEL_ID in src/lib/depthModel.ts")
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    args = ap.parse_args()
    assert args.size % 14 == 0, "size must be a multiple of 14"

    torch.manual_seed(0)
    random.seed(0)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    amp = device.type == "cuda"
    os.makedirs(args.out, exist_ok=True)
    train_f, val_f = split_files(args.data, args.val)
    print(f"device={device} train={len(train_f)} val={len(val_f)}", flush=True)

    tl = torch.utils.data.DataLoader(Pairs(train_f, args.size, True), batch_size=args.bs, shuffle=True,
                                     num_workers=args.workers, drop_last=True, pin_memory=amp, persistent_workers=args.workers > 0)
    vl = torch.utils.data.DataLoader(Pairs(val_f, args.size, False), batch_size=args.bs, num_workers=args.workers)

    base = load_model(args.init).to(device).eval()
    model = load_model(args.init).to(device)
    if args.init == "tiny":
        model.load_state_dict(base.state_dict())
    freeze(model, args.freeze_blocks)

    baseline = evaluate(base, vl, device, amp)
    print("original model on held-out reliefs:", baseline, flush=True)

    enc = [p for n, p in model.named_parameters() if p.requires_grad and n.startswith("backbone")]
    dec = [p for n, p in model.named_parameters() if p.requires_grad and not n.startswith("backbone")]
    opt = torch.optim.AdamW([{"params": enc, "lr": args.lr_enc}, {"params": dec, "lr": args.lr_dec}], weight_decay=0.01)
    warm = max(1, min(300, args.steps // 10))
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps))))
    scaler = torch.amp.GradScaler(enabled=amp)

    best = dict(baseline)
    best_path = os.path.join(args.out, "best.pt")
    torch.save(model.state_dict(), best_path)
    log = []
    step, t0 = 0, time.time()
    model.train()
    while step < args.steps:
        for x, h in tl:
            x, h = x.to(device, non_blocking=True), h.to(device, non_blocking=True)
            with torch.autocast(device.type, dtype=torch.float16, enabled=amp):
                p = predict(model, x)
            loss, _, _ = relief_loss(p.float(), h)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            step += 1
            if step % 50 == 0:
                print(f"step {step}/{args.steps} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
            if step % args.eval_every == 0 or step == args.steps:
                m = evaluate(model, vl, device, amp)
                log.append({"step": step, **m})
                print(f"  eval step {step}: {m}  (original {baseline['score']:.4f})", flush=True)
                if m["score"] < best["score"]:
                    best = dict(m)
                    torch.save(model.state_dict(), best_path)
            if step >= args.steps:
                break

    model.load_state_dict(torch.load(best_path, map_location=device))
    final = evaluate(model, vl, device, amp)
    improved = final["score"] < baseline["score"]
    comparison_grid(base, model, val_f, args.size, device, os.path.join(args.out, "compare.png"))

    pkg = os.path.join(args.out, args.name)
    shutil.rmtree(pkg, ignore_errors=True)
    model.config.architectures = ["DepthAnythingForDepthEstimation"]
    model.config.save_pretrained(pkg)
    save_processor(args.init, pkg)
    exp = export_onnx(model, pkg, args.size)
    report = {"original": baseline, "fine_tuned": final, "improved": improved,
              "improvement_pct": round(100 * (1 - final["score"] / baseline["score"]), 1),
              "export": exp, "steps": args.steps, "train_samples": len(train_f), "log": log}
    with open(os.path.join(args.out, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != "log"}, indent=2))
    if not improved:
        print("WARNING: the fine-tuned model did not beat the original on held-out reliefs. Do not ship it.")
    shutil.make_archive(pkg, "zip", args.out, args.name)
    os.remove(best_path)  # 100 MB checkpoint; the zip has everything the site needs
    print("model package:", pkg + ".zip")


if __name__ == "__main__":
    main()
