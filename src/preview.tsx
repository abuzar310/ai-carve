import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ReliefMesh } from "./lib/mesh";

type View = "fit" | "front" | "top" | "side" | "persp";

function heightColors(mesh: ReliefMesh, on: boolean): Float32Array {
  const n = mesh.positions.length / 3;
  const out = new Float32Array(n * 3);
  const lo = mesh.meta.topZMin;
  const span = mesh.meta.topZMax - lo || 1;
  const topN = n / 2;
  for (let i = 0; i < n; i++) {
    const z = mesh.positions[i * 3 + 2] ?? 0;
    const t = on && i < topN ? Math.min(1, Math.max(0, (z - lo) / span)) : on ? 0.18 : 0.62;
    out[i * 3] = 0.28 + t * 0.68;
    out[i * 3 + 1] = 0.2 + t * 0.66;
    out[i * 3 + 2] = 0.12 + t * 0.55;
  }
  return out;
}

export function ReliefPreview({
  source,
  rev,
  wireframe,
  showBase,
  tint,
  view,
  viewTick,
}: {
  source: { current: ReliefMesh | null };
  rev: number;
  wireframe: boolean;
  showBase: boolean;
  tint: boolean;
  view: View;
  viewTick: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    geo: THREE.BufferGeometry;
    mat: THREE.MeshStandardMaterial;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    host: HTMLDivElement;
    paint: () => void;
    applyView: (v: View) => void;
    setRange: (show: boolean, top?: number, walls?: number) => void;
  } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14110e);
    scene.fog = new THREE.Fog(0x14110e, 420, 1400);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);
    camera.up.set(0, 0, 1);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    } catch {
      el.classList.add("ph");
      el.textContent = "3D preview unavailable. This browser is not providing WebGL. You can still download the STL.";
      return;
    }
    renderer.setPixelRatio(/iP(hone|ad|od)/.test(navigator.userAgent) ? 1 : Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      el.classList.add("ph");
      el.textContent = "3D preview unavailable. This browser stopped WebGL on this model. You can still download the STL.";
    });
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x4a453c, 0.08));
    scene.add(new THREE.HemisphereLight(0xf6edd8, 0x14110c, 0.18));
    const key = new THREE.DirectionalLight(0xfff3d4, 2.8);
    key.position.set(6, -36, 4);
    scene.add(key);
    const skim = new THREE.DirectionalLight(0xffe8b8, 1.15);
    skim.position.set(40, -8, 3);
    scene.add(skim);
    const fill = new THREE.DirectionalLight(0x8aa0b8, 0.18);
    fill.position.set(-40, 16, 22);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffdca0, 0.55);
    rim.position.set(-6, 64, 14);
    scene.add(rim);
    const rake = new THREE.DirectionalLight(0xfff1c8, 2.1);
    rake.position.set(-18, -48, 6);
    scene.add(rake);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(240, 64),
      new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1, metalness: 0 }),
    );
    floor.position.z = -0.4;
    scene.add(floor);

    const geo = new THREE.BufferGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.38,
      metalness: 0.03,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    const obj = new THREE.Mesh(geo, mat);
    scene.add(obj);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    const fitSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    fitSize();

    const applyView = (v: View) => {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const box = geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 1));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const fit = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
      controls.target.copy(center);
      controls.minDistance = maxDim * 0.35;
      controls.maxDistance = maxDim * 10;
      if (v === "top") camera.position.set(center.x, center.y, center.z + fit * 1.12);
      else if (v === "front") camera.position.set(center.x, center.y - fit * 1.02, center.z + size.z * 0.45);
      else if (v === "side") camera.position.set(center.x + fit * 1.02, center.y, center.z + size.z * 0.45);
      else if (v === "fit") camera.position.set(center.x + fit * 0.7, center.y - fit * 0.86, center.z + fit * 0.3);
      else camera.position.set(center.x + fit * 0.38, center.y - fit * 0.76, center.z + fit * 0.66); // ~35° above, whole panel in view
      camera.near = Math.max(0.05, maxDim / 200);
      camera.far = maxDim * 40;
      camera.updateProjectionMatrix();
      controls.update();
      paint();
    };

    const gpuName = String(renderer.getContext().getParameter(renderer.getContext().RENDERER) || "");
    const software = /swiftshader|llvmpipe|softpipe/i.test(gpuName);
    if (software) controls.enableDamping = false;

    let dirty = true;
    let cursor = 0;
    let sliceTris = software ? 24_000 : Number.POSITIVE_INFINITY;
    let drawLimit = 0;
    const paint = () => {
      dirty = true;
      cursor = 0;
      el.dataset.drawn = "0";
    };
    const setRange = (show: boolean, top = 0, walls = 0) => {
      const n = geo.getIndex()?.count ?? 0;
      drawLimit = show ? n : Math.max(0, top + walls);
      paint();
    };
    api.current = { geo, mat, camera, controls, renderer, host: el, applyView, setRange, paint };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!dirty) {
        if (controls.update()) paint();
        return;
      }
      const count = geo.getIndex()?.count ?? 0;
      const limit = drawLimit > 0 ? Math.min(drawLimit, count) : count;
      if (!count || limit <= 0) return;
      const room = limit - cursor;
      const n = Math.min(room, Math.max(3, sliceTris * 3));
      const t0 = performance.now();
      geo.setDrawRange(cursor, n);
      const first = cursor === 0;
      floor.visible = first;
      renderer.autoClear = first;
      if (first) renderer.clear();
      renderer.render(scene, camera);
      cursor += n;
      const dt = performance.now() - t0;
      if (software) {
        if (dt < 14) sliceTris = Math.min(1_500_000, Math.round(sliceTris * 1.5));
        else if (dt > 48) sliceTris = Math.max(6_000, Math.round(sliceTris * 0.65));
      }
      if (cursor >= limit) {
        geo.setDrawRange(0, limit);
        renderer.autoClear = true;
        floor.visible = true;
        dirty = false;
        cursor = 0;
        el.dataset.drawn = "1";
      }
    };
    tick();
    const ro = new ResizeObserver(() => {
      fitSize();
      paint();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // mesh.ranges used only for drawRange after attributes load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const a = api.current;
    const mesh = source.current;
    if (!a || !mesh) return;
    const put = (name: string, itemSize: number, data: Float32Array) => {
      const prev = a.geo.getAttribute(name);
      if (prev && prev.array.length === data.length) {
        (prev.array as Float32Array).set(data);
        prev.needsUpdate = true;
        return;
      }
      a.geo.setAttribute(name, new THREE.BufferAttribute(data, itemSize));
    };
    put("position", 3, mesh.positions);
    put("normal", 3, mesh.normals);
    const prevIndex = a.geo.getIndex();
    if (!prevIndex || prevIndex.array.length !== mesh.indices.length) {
      a.geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    }
    const { widthMm, heightMm, zMax } = mesh.meta;
    a.geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-widthMm / 2, -heightMm / 2, 0),
      new THREE.Vector3(widthMm / 2, heightMm / 2, zMax),
    );
    a.geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, zMax / 2),
      0.5 * Math.hypot(widthMm, heightMm, zMax),
    );
    const ratio = mesh.meta.triangleCount > 1_500_000 ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    a.renderer.setPixelRatio(ratio);
    const w = a.host.clientWidth;
    const h = a.host.clientHeight;
    if (w > 8 && h > 8) a.renderer.setSize(w, h, false);
    a.host.dataset.w = String(widthMm);
    a.host.dataset.h = String(heightMm);
    a.host.dataset.z = String(Math.round(zMax * 100) / 100);
    a.paint();
  }, [rev, source]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const mesh = source.current;
    if (!mesh) return;
    const colors = heightColors(mesh, tint);
    const prev = a.geo.getAttribute("color");
    if (prev && prev.array.length === colors.length) {
      (prev.array as Float32Array).set(colors);
      prev.needsUpdate = true;
    } else {
      a.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    a.paint();
  }, [tint, rev, source]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.mat.wireframe = wireframe;
    a.mat.needsUpdate = true;
    a.paint();
  }, [wireframe]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const mesh = source.current;
    if (!mesh) return;
    a.setRange(showBase, mesh.ranges.top, mesh.ranges.walls);
    a.paint();
  }, [showBase, rev, source]);

  useEffect(() => {
    api.current?.applyView(view);
  }, [view, viewTick]);

  return <div ref={host} className="gl" />;
}
