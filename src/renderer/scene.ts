import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class HouseScene {
  readonly canvas = document.createElement("canvas");
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
  private frame?: number;
  constructor(private readonly host: HTMLElement) {
    this.camera.position.set(5, 4, 5); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x172033, 1.2));
    const grid = new THREE.GridHelper(10, 10, 0x61718b, 0x2c3850); this.scene.add(grid);
    new ResizeObserver(() => this.resize()).observe(host); document.addEventListener("visibilitychange", this.onVisibility);
  }
  async load(url: string) { const gltf = await new GLTFLoader().loadAsync(url); this.scene.add(gltf.scene); }
  start() { const render = () => { this.renderer.render(this.scene, this.camera); this.frame = requestAnimationFrame(render); }; render(); }
  dispose() { if (this.frame) cancelAnimationFrame(this.frame); document.removeEventListener("visibilitychange", this.onVisibility); this.renderer.dispose(); }
  private resize() { const { clientWidth: width, clientHeight: height } = this.host; this.camera.aspect = width / Math.max(height, 1); this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false); }
  private onVisibility = () => document.hidden ? this.frame && cancelAnimationFrame(this.frame) : this.start();
}
