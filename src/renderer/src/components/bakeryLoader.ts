import * as THREE from 'three';
import { createBakeryModel } from '../../bakery/models.js';

export function mountBakeryLoader(canvas: HTMLCanvasElement, surface: string, animationsDisabled: boolean): (() => void) | null {
  if (typeof WebGL2RenderingContext === "undefined") return null;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); }
  catch { return null; }
  renderer.setSize(canvas.width, canvas.height, false);
  const reducedMotion = animationsDisabled || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const modelId = ({ initial: 'toaster', welcome: 'hot-cross-bun', finish: 'cupcake', sources: 'mixing-bowl', preview: 'whisk', search: 'bagel', connection: 'donut', empty: 'empty-sign' } as Record<string, string>)[surface] ?? 'rolling-pin';
  let frame = 0;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x987457, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(3, 6, 4); scene.add(light);
    const model = surface === "connection" ? new THREE.Group() : createBakeryModel(modelId);
    scene.add(model);
    let toast: THREE.Group | undefined, dough: THREE.Mesh | undefined;
    const steam: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
    const donutPieces: THREE.Group[][] = [];
    if (surface === 'connection') {
      const cardboard = new THREE.MeshStandardMaterial({ color: '#d9ae7e', roughness: .9 });
      const inside = new THREE.MeshStandardMaterial({ color: '#f3d7b1', roughness: .9 });
      const pastry = new THREE.MeshStandardMaterial({ color: '#d69143', roughness: .8 });
      const glazes = ['#ed91a2', '#f5e3be', '#825040'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .65 }));
      function panel(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
        mesh.position.set(x,y,z); model.add(mesh);
      }
      panel(0,.08,0,2.2,.12,1.45,cardboard);
      panel(0,.22,-.69,2.2,.3,.08,cardboard); panel(0,.22,.69,2.2,.3,.08,cardboard);
      panel(-1.06,.22,0,.08,.3,1.4,cardboard); panel(1.06,.22,0,.08,.3,1.4,cardboard);
      panel(0,.151,0,2,.02,1.2,inside);
      for (let i=0; i<3; i++) {
        const pieces: THREE.Group[] = [];
        for (let j=0; j<12; j++) {
          const piece = new THREE.Group();
          for (const [radius, tube, height, material] of [[.30,.13,.28,pastry],[.30,.095,.35,glazes[i]]] as const) {
            const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius,tube,10,5,Math.PI*2/12),material);
            mesh.rotation.x = Math.PI/2; mesh.rotation.z = j*Math.PI*2/12; mesh.position.y=height; piece.add(mesh);
          }
          piece.position.x=(i-1)*.67; model.add(piece); pieces.push(piece);
        }
        donutPieces.push(pieces);
      }
    }
    if (surface === 'initial') {
      // Two rounded slices rising from the toaster slots.
      toast = new THREE.Group();
      const crust = new THREE.MeshStandardMaterial({ color: '#a45c2c', roughness: .85 });
      const crumb = new THREE.MeshStandardMaterial({ color: '#eac68a', roughness: .9 });
      for (const z of [-.18,.18]) {
        const slice = new THREE.Group();
        const edge = new THREE.Mesh(new THREE.BoxGeometry(.64,.46,.075), crust);
        const face = new THREE.Mesh(new THREE.BoxGeometry(.54,.36,.08), crumb);
        slice.add(edge, face); slice.position.z = z; toast.add(slice);
      }
      toast.position.y = .8; scene.add(toast);
    } else if (surface === 'sources') {
      const extra = createBakeryModel('whisk'); extra.scale.setScalar(.7); extra.rotation.z = -.55; extra.position.set(.2,.5,0); model.add(extra);
    }
    if (modelId === 'rolling-pin') {
      dough = new THREE.Mesh(new THREE.SphereGeometry(1,32,20), new THREE.MeshStandardMaterial({color:'#efd4a4',roughness:.9}));
      dough.scale.set(.8,.1,.48); dough.position.y=.1; scene.add(dough);
      model.position.y=.12;
    }
    if (['hot-cross-bun','cupcake'].includes(modelId)) {
      for (let i=0;i<3;i++) {
        const mat = new THREE.MeshBasicMaterial({color:'#b9ada0', transparent:true, opacity:.45, depthWrite:false});
        const puff = new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),mat);
        scene.add(puff); steam.push(puff);
      }
    }
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
    camera.position.set(3, 2.6, 4); camera.lookAt(0,.4,0);
    function render(time = 0) {
      const t = reducedMotion ? 0 : (time - startedAt) / 1000;
      if (steam.length) {
        model.rotation.y = t * .3;
        steam.forEach((puff,i) => {
          const phase = (t*.3 + i/3) % 1;
          puff.position.set((i-1)*.17 + Math.sin(phase*6+i)*.07, (modelId === 'cupcake' ? 1.15 : .75) + phase*.65, 0);
          puff.scale.setScalar(.7+phase); puff.material.opacity = reducedMotion ? .2 : .42*Math.sin(Math.PI*phase);
        });
      }
      if (toast) {
        // Pause at each end, then rise and return smoothly.
        const cycle = (t % 3.6) / 3.6;
        const rise = cycle < .2 ? 0 : cycle < .35 ? (cycle-.2)/.15 : cycle < .65 ? 1 : cycle < .8 ? 1-(cycle-.65)/.15 : 0;
        toast.position.y = .67 + rise*.48;
      }
      if (dough) {
        model.position.z = Math.sin(t*1.5)*.28;
        model.rotation.x = Math.sin(t*1.5)*1.2;
        const flatten = (Math.sin(t*1.5)+1)/2;
        dough.scale.set(.78+flatten*.08,.1-flatten*.025,.46+flatten*.04);
      }
      if (surface === 'connection' && !reducedMotion) {
        const cycle = t % 11;
        // Each donut loses successive segments, then the empty box leaves and a full one arrives.
        const bites = Math.max(0, Math.floor((cycle - 1) * 4.5));
        donutPieces.forEach((pieces, i) => pieces.forEach((piece, j) => { piece.visible = cycle >= 9.5 || bites < i*12+j+1; }));
        model.position.x = cycle < 8.8 ? 0 : cycle < 9.5 ? -(cycle-8.8)/.7*5 : cycle < 10.5 ? (10.5-cycle)*5 : 0;
      }
      if (modelId === 'whisk') model.rotation.y = t*1.5;
      renderer.render(scene,camera);
      if (!reducedMotion && surface !== "sources" && surface !== "empty") frame = requestAnimationFrame(render);
    }
    const startedAt = performance.now();
    render(startedAt);

  return () => {
    cancelAnimationFrame(frame);
    const geometries = new Set<THREE.BufferGeometry>();
    scene.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
    geometries.forEach(geometry => geometry.dispose());
    // Model materials are shared by the factory. Only release the renderer here.
    renderer.dispose();
  };
}
