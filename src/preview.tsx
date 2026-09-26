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
  mesh,
  wireframe,
  showBase,
  tint,
  view,
  viewTick,
}: {
  mesh: ReliefMesh;
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
    applyView: (v: View) => void;
    setRange: (show: boolean, top?: number, walls?: number) => void;
  } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10140f);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);
    camera.up.set(0, 0, 1);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      el.classList.add("ph");
      el.textContent = "3D preview needs WebGL. STL export still works.";
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x6b6254, 0.16));
    scene.add(new THREE.HemisphereLight(0xf3ead8, 0x1a1610, 0.28));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.15);
    key.position.set(12, -48, 7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9eb4cc, 0.28);
    fill.position.set(-50, 20, 30);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe2b0, 0.55);
    rim.position.set(-8, 70, 18);
    scene.add(rim);

    const geo = new THREE.BufferGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
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
      geo.computeBoundingBox();
      const box = geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 1));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
      controls.target.copy(center);
      if (v === "top") camera.position.set(center.x, center.y, center.z + dist);
      else if (v === "front") camera.position.set(center.x, center.y - dist, center.z + maxDim * 0.15);
      else if (v === "side") camera.position.set(center.x + dist, center.y, center.z + maxDim * 0.15);
      else {
        camera.position.set(center.x + dist * 0.95, center.y - dist * 1.22, center.z + Math.max(size.z * 2.4, dist * 0.16));
      }
      camera.near = Math.max(0.05, dist / 200);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.update();
    };

    const setRange = (show: boolean, top = 0, walls = 0) => {
      const n = geo.getIndex()?.count ?? 0;
      geo.setDrawRange(0, show ? n : Math.max(0, top + walls));
    };

    api.current = { geo, mat, camera, controls, applyView, setRange };

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    const ro = new ResizeObserver(fitSize);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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
    if (!a) return;
    a.geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    a.geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    a.geo.setAttribute("color", new THREE.BufferAttribute(heightColors(mesh, tint), 3));
    a.geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    a.geo.computeBoundingBox();
    a.geo.computeBoundingSphere();
    a.setRange(showBase, mesh.ranges.top, mesh.ranges.walls);
  }, [mesh, showBase, tint]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.mat.wireframe = wireframe;
    a.mat.needsUpdate = true;
  }, [wireframe]);

  useEffect(() => {
    api.current?.setRange(showBase, mesh.ranges.top, mesh.ranges.walls);
  }, [showBase, mesh]);

  useEffect(() => {
    api.current?.applyView(view);
  }, [view, viewTick]);

  return <div ref={host} className="gl" />;
}
