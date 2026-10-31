import * as THREE from 'three';

// All models are centered near the origin and use the same warm, matte palette.
const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
const crust = material('#c87932'), golden = material('#e5a550'), pale = material('#f4d9a0');
const dark = material('#874824'), cream = material('#fff0ce'), pink = material('#e98e9d');
const chocolate = material('#563023'), paper = material('#c99a72');
const seeds = material('#f7e4b7');
function ellipsoid(group, mat, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); group.add(mesh); return mesh;
}
function tube(group, mat, points, radius = .035) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 8, false), mat); group.add(mesh); return mesh;
}
function ring(group, mat, major, minor, y, sx = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(major, minor, 16, 48), mat);
  mesh.rotation.x = Math.PI / 2; mesh.position.y = y; mesh.scale.set(sx, sz, 1); group.add(mesh); return mesh;
}
function sprinkle(group, x, z, angle, mat = seeds, y = .45) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(.018, .09, 4, 8), mat);
  m.position.set(x, y, z); m.rotation.set(Math.PI / 2, angle, 0); group.add(m);
}
function bun(g) {
  ellipsoid(g, crust, 0, .25, 0, .8, .48, .7);
  tube(g, cream, [[-.65,.48,0],[-.35,.67,0],[0,.73,0],[.35,.67,0],[.65,.48,0]], .045);
  tube(g, cream, [[0,.49,-.58],[0,.67,-.3],[0,.73,0],[0,.67,.3],[0,.49,.58]], .045);
}
function loaf(g) {
  ellipsoid(g, crust, 0, .28, 0, 1.05, .48, .61);
  for (const x of [-.52, 0, .52]) tube(g, pale, [[x-.18,.53,-.4],[x,.72,0],[x+.18,.53,.4]], .035);
}
function baguette(g) {
  ellipsoid(g, golden, 0, .18, 0, 1.3, .3, .32);
  for (const x of [-.75,-.25,.25,.75]) tube(g, pale, [[x-.13,.35,-.22],[x,.48,0],[x+.13,.35,.22]], .025);
}
function croissant(g) {
  for (let i = 0; i < 9; i++) {
    const t = (i / 8 - .5) * 2; const m = ellipsoid(g, i % 2 ? golden : crust, t*.85, .22, .34*t*t, .24*(1-Math.abs(t)*.45), .35*(1-Math.abs(t)*.35), .37*(1-Math.abs(t)*.35)); m.rotation.y = -t*.65;
  }
}
function bagel(g) {
  ring(g, crust, .53, .25, .24, 1, .9);
  for (let i=0;i<28;i++) { const a=i*2.4, r=.48+(i%3)*.05; sprinkle(g, Math.cos(a)*r, Math.sin(a)*r*.9, a, seeds, .46); }
}
function donut(g) {
  ring(g, golden, .52, .25, .24); ring(g, pink, .52, .19, .33);
  const colors=[cream, chocolate, seeds];
  for(let i=0;i<24;i++){const a=i*2.4,r=.43+(i%4)*.055; sprinkle(g,Math.cos(a)*r,Math.sin(a)*r,a+.8,colors[i%3],.51);}
}
function cupcake(g) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.48,.34,.55,32),paper); base.position.y=.28; g.add(base);
  ellipsoid(g, cream, 0,.62,0,.53,.24,.53); ellipsoid(g, cream, 0,.79,0,.4,.2,.4); ellipsoid(g, cream, 0,.94,0,.24,.16,.24); ellipsoid(g, pink, 0,1.1,0,.09,.09,.09);
  for (let i=0;i<22;i++) { const a=i*2.4, r=.2+(i%3)*.095; sprinkle(g,Math.cos(a)*r,Math.sin(a)*r,a,[pink,chocolate,golden][i%3],.66 + .28*(1-r/.55)); }
}
function pretzel(g) {
  tube(g, crust, [[0,.22,-.25],[-.55,.22,.42],[-.83,.22,.15],[-.75,.22,-.35],[-.42,.22,-.48],[.45,.22,.38],[.78,.22,.22],[.78,.22,-.25],[.48,.22,-.48],[-.45,.22,.38]], .12);
  for(let i=0;i<12;i++){const a=i*2.4; sprinkle(g,Math.cos(a)*.57,Math.sin(a)*.3,a,seeds,.34);}
}
function cinnamon(g) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.66,.68,.42,48), golden); body.position.y=.22; g.add(body);
  const pts=[]; for(let i=0;i<=80;i++){const a=i/80*Math.PI*5, r=.04+i/80*.55; pts.push([Math.cos(a)*r,.45,Math.sin(a)*r]);} tube(g,dark,pts,.04);
}
function cookie(g) {
  ellipsoid(g,golden,0,.14,0,.75,.2,.72);
  for(const [x,z] of [[-.4,-.2],[.05,-.42],[.42,-.2],[-.2,.1],[.25,.15],[-.42,.38],[.12,.42]]) ellipsoid(g,chocolate,x,.29,z,.075,.035,.065);
}
function box(g, mat, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y, z); g.add(mesh); return mesh;
}
const steel = material('#b9bec0'), steelDark = material('#777d7e'), wood = material('#b77a46');
function toaster(g) {
  box(g, steel, 0,.42,0,1.25,.75,.72);
  box(g, steelDark, 0,.81,-.18,.9,.025,.12); box(g, steelDark, 0,.81,.18,.9,.025,.12);
  box(g, steelDark, .66,.43,0,.08,.36,.05); ellipsoid(g,dark,.72,.48,0,.1,.05,.08);
  ellipsoid(g,dark,.65,.22,.22,.035,.035,.035);
}
function rollingPin(g) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,1.2,32), wood); body.rotation.z=Math.PI/2; body.position.y=.25; g.add(body);
  for(const x of [-.77,.77]) { const h=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.36,20),dark); h.rotation.z=Math.PI/2; h.position.set(x,.25,0); g.add(h); }
}
function mixingBowl(g) {
  const points=[]; for(let i=0;i<=24;i++){const t=i/24*Math.PI/2; points.push(new THREE.Vector2(.72*Math.sin(t), .12+.65*(1-Math.cos(t))));}
  const m=new THREE.Mesh(new THREE.LatheGeometry(points,48), steel); m.material=steel.clone(); m.material.side=THREE.DoubleSide; g.add(m); ring(g,steelDark,.72,.035,.77);
}
function whisk(g) {
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,.55,20),wood); handle.position.y=.3; g.add(handle);
  ellipsoid(g, steelDark, 0,.6,0,.1,.08,.1);
  for(let i=0;i<4;i++) {
    const a=i*Math.PI/4, pts=[];
    for(let j=0;j<=32;j++){const t=j/32*Math.PI*2; pts.push([Math.cos(a)*Math.sin(t)*.23,.93-.33*Math.cos(t),Math.sin(a)*Math.sin(t)*.23]);}
    tube(g,steelDark,pts,.018);
  }
}
function spatula(g) {
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.95,16),wood); handle.position.y=.48; g.add(handle);
  box(g, cream, 0,1.1,0,.45,.38,.09);
}
function bakingTray(g) {
  box(g,steelDark,0,.08,0,1.5,.1,1); box(g,steel,0,.15,-.48,1.5,.15,.05); box(g,steel,0,.15,.48,1.5,.15,.05);
  box(g,steel,-.73,.15,0,.05,.15,.95); box(g,steel,.73,.15,0,.05,.15,.95);
}
function ovenMitt(g) {
  ellipsoid(g, pink, 0,.52,0,.4,.65,.16); const thumb=ellipsoid(g,pink,-.39,.5,0,.18,.32,.16); thumb.rotation.z=-.65;
  box(g,cream,0,.12,0,.65,.15,.34);
}
function measuringCup(g) {
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.43,.32,.65,32,1,true),steel); m.material=steel.clone(); m.material.side=THREE.DoubleSide; m.position.y=.37; g.add(m);
  const bottom=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.04,32),steel); bottom.position.y=.05; g.add(bottom);
  ring(g,steelDark,.43,.025,.7); tube(g,steelDark,[[.4,.62,0],[.7,.6,0],[.75,.35,0],[.37,.3,0]],.045);
}
function emptySign(g) {
  box(g,wood,0,.12,0,1.1,.12,.48); box(g,wood,0,.55,0,.09,.8,.1);
  box(g,dark,0,.9,0,1.5,.7,.12); box(g,cream,0,.9,.07,1.36,.56,.025);
  const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=220;
  const ctx=canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle='#fff0ce'; ctx.fillRect(0,0,512,220); ctx.fillStyle='#704029';
    ctx.textAlign='center'; ctx.font='bold 55px sans-serif'; ctx.fillText('NO BREAD',256,90); ctx.font='bold 40px sans-serif'; ctx.fillText('AVAILABLE',256,150);
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    const label=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.53),new THREE.MeshBasicMaterial({map:texture})); label.position.set(0,.9,.09); g.add(label);
  }
}
export const bakeryModels = [
  ['hot-cross-bun','Hot cross bun',bun], ['sourdough','Sourdough loaf',loaf], ['baguette','Baguette',baguette],
  ['croissant','Croissant',croissant], ['bagel','Sesame bagel',bagel], ['donut','Strawberry donut',donut],
  ['cupcake','Cupcake',cupcake], ['pretzel','Pretzel',pretzel], ['cinnamon-roll','Cinnamon roll',cinnamon], ['cookie','Chocolate chip cookie',cookie],
  ['toaster','Toaster',toaster], ['rolling-pin','Rolling pin',rollingPin], ['mixing-bowl','Mixing bowl',mixingBowl],
  ['whisk','Whisk',whisk], ['spatula','Spatula',spatula], ['baking-tray','Baking tray',bakingTray],
  ['empty-sign','No bread sign',emptySign],
  ['oven-mitt','Oven mitt',ovenMitt], ['measuring-cup','Measuring cup',measuringCup],
];
export function createBakeryModel(id) {
  const entry = bakeryModels.find(model => model[0] === id);
  if (!entry) throw new Error(`Unknown bakery model: ${id}`);
  const group = new THREE.Group(); group.name = entry[0]; entry[2](group); return group;
}
