import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RotateCw } from 'lucide-react';

import { MEASURE_ZONES } from '../lib/measureZones';

const ZONE_COLORS = { pending: 0xf59e0b, done: 0x10b981, na: 0x475569 };
const ACTIVE_COLOR = 0x22d3ee;
const FREE_GLASS = 0x1b2027; // ventana que no está en ningún corte (modelo 3)
const PAINT = 0xb9bfc8; // plata metalizada
const GLASS_TINT = new THREE.Color(0x0c0e11);
const CAMERA_DISTANCE = 7.4;

// El carro mira hacia +X; +Z es el lado derecho (copiloto) y -Z el izquierdo (piloto).
// Ventanas físicas del carro: cada una es una pieza que se puede pintar por separado.
export const WINDOW_IDS = ['panoramico', 'luneta', 'sunroof', 'delantera_der', 'delantera_izq',
    'trasera_der', 'trasera_izq', 'custodia_der', 'custodia_izq'];

// Modelo 1: zonas del técnico → ventanas
export const STANDARD_ZONE_WINDOWS = {
    panoramico: ['panoramico'],
    trasero: ['luneta'],
    laterales_delanteros: ['delantera_der', 'delantera_izq'],
    laterales_traseros: ['trasera_der', 'custodia_der', 'trasera_izq', 'custodia_izq'],
    laterales_derecho: ['delantera_der', 'trasera_der', 'custodia_der'],
    laterales_izquierdo: ['delantera_izq', 'trasera_izq', 'custodia_izq'],
    sunroof: ['sunroof'],
};
const DEFAULT_ZONES = MEASURE_ZONES.map(z => ({ id: z.id, n: z.n, windows: STANDARD_ZONE_WINDOWS[z.id] }));

// ---------- geometría: sedán deportivo de 4 puertas ----------
const BELT = 0.98; // línea de cintura donde empieza la cabina
const taper = (y) => 1 - Math.max(0, y - BELT) * 0.5; // la cabina se angosta hacia el techo
// Hombros redondeados arriba y bajos metidos hacia adentro (la carrocería no es un bloque recto)
const shoulder = (y) => (1 - Math.max(0, y - 0.62) * 0.2) * (1 - Math.max(0, 0.52 - y) * 0.16);
// Vista en planta: la nariz y la cola se redondean (el carro no es un bloque)
const plan = (x) => {
    if (x > 1.62) return Math.max(0.72, 1 - 0.24 * ((x - 1.62) / 0.72) ** 2);
    if (x < -1.7) return Math.max(0.74, 1 - 0.2 * ((-x - 1.7) / 0.66) ** 2);
    return 1;
};
const deform = (geo, fn) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setZ(i, pos.getZ(i) * fn(pos.getX(i), pos.getY(i)));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
};

// Perfil lateral: nariz baja y redonda, capó largo, baúl corto con labio y pasos de rueda
const bodyShape = () => {
    const s = new THREE.Shape();
    s.moveTo(-2.26, 0.34);
    s.quadraticCurveTo(-2.4, 0.52, -2.36, 0.76);
    s.quadraticCurveTo(-2.33, 0.92, -2.2, 0.96);
    s.lineTo(-1.55, BELT);
    s.lineTo(1.25, BELT);
    s.quadraticCurveTo(1.9, 0.93, 2.18, 0.74);
    s.quadraticCurveTo(2.4, 0.6, 2.36, 0.44);
    s.quadraticCurveTo(2.32, 0.3, 2.14, 0.28);
    s.lineTo(1.92, 0.28);
    s.absarc(1.42, 0.38, 0.5, 0, Math.PI, false);
    s.lineTo(-0.92, 0.28);
    s.absarc(-1.42, 0.38, 0.5, 0, Math.PI, false);
    s.lineTo(-2.26, 0.28);
    return s;
};
// Cabina fastback: parabrisas → techo → vidrio trasero largo
const cabinShape = () => {
    const s = new THREE.Shape();
    s.moveTo(-1.55, BELT);
    s.quadraticCurveTo(-0.95, 1.28, -0.45, 1.47);
    s.quadraticCurveTo(-0.02, 1.53, 0.4, 1.47);
    s.lineTo(1.25, BELT);
    s.closePath();
    return s;
};

const quad = (a, b, c, d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    return g;
};
// Vidrio que sigue una curva del perfil (luneta fastback), desplazado hacia afuera
const curvedPanel = (p0, ctrl, p1, offset, zFrom, zTo, t0 = 0.06, t1 = 0.96, steps = 14) => {
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = t0 + ((t1 - t0) * i) / steps;
        const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * ctrl[0] + t ** 2 * p1[0];
        const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * ctrl[1] + t ** 2 * p1[1];
        const dx = 2 * (1 - t) * (ctrl[0] - p0[0]) + 2 * t * (p1[0] - ctrl[0]);
        const dy = 2 * (1 - t) * (ctrl[1] - p0[1]) + 2 * t * (p1[1] - ctrl[1]);
        const len = Math.hypot(dx, dy) || 1;
        pts.push({ x: x - (dy / len) * offset, y: y + (dx / len) * offset, z: zFrom + (zTo - zFrom) * (i / steps) });
    }
    const pos = [];
    for (let i = 0; i < steps; i += 1) {
        const a = pts[i]; const b = pts[i + 1];
        pos.push(a.x, a.y, -a.z, a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y, -a.z, b.x, b.y, b.z, b.x, b.y, -b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
};
const flatShape = (points) => {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    s.closePath();
    return new THREE.ShapeGeometry(s);
};

// Ventanas laterales (vista lateral) y su centro para el número
const SIDE_Z = 0.765;
const SIDE_WINDOWS = {
    delantera: { pts: [[1.12, 1.03], [0.4, 1.42], [0.02, 1.43], [0.02, 1.03]], center: [0.5, 1.22] },
    trasera: { pts: [[-0.06, 1.03], [-0.06, 1.43], [-0.5, 1.41], [-0.7, 1.31], [-0.7, 1.03]], center: [-0.36, 1.22] },
    custodia: { pts: [[-0.78, 1.03], [-0.78, 1.27], [-1.17, 1.07], [-1.24, 1.03]], center: [-0.93, 1.1] },
};
const sideZ = (y, side) => side * (SIDE_Z + 0.004) * taper(y);
const windowCenter = (id) => {
    if (id === 'panoramico') return [0.9, 1.3, 0];
    if (id === 'luneta') return [-0.98, 1.36, 0];
    if (id === 'sunroof') return [-0.04, 1.6, 0];
    const [kind, sideKey] = id.split('_');
    const side = sideKey === 'der' ? 1 : -1;
    const [x, y] = SIDE_WINDOWS[kind].center;
    return [x, y, (SIDE_Z + 0.09) * taper(y) * side];
};
const windowGeometry = (id) => {
    const zB = 0.66;
    const zT = 0.5;
    if (id === 'panoramico') return quad([1.31, 1.01, -zB], [1.31, 1.01, zB], [0.45, 1.515, zT], [0.45, 1.515, -zT]);
    if (id === 'luneta') return curvedPanel([-1.55, BELT], [-0.95, 1.28], [-0.45, 1.47], 0.075, zB, zT);
    if (id === 'sunroof') return quad([-0.4, 1.575, -0.4], [-0.4, 1.575, 0.4], [0.34, 1.578, 0.4], [0.34, 1.578, -0.4]);
    const [kind, sideKey] = id.split('_');
    const side = sideKey === 'der' ? 1 : -1;
    const geo = flatShape(SIDE_WINDOWS[kind].pts);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setZ(i, sideZ(pos.getY(i), side));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
};

const labelSprite = (text) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(32, 32, 25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${String(text).length > 1 ? 26 : 34}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(text), 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.scale.set(0.28, 0.28, 0.28);
    sprite.renderOrder = 10;
    return sprite;
};

// Sombra de contacto suave bajo el carro
const contactShadow = () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 64, 8, 128, 64, 128);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.005;
    return m;
};

const buildCar = (windowMeshes) => {
    const car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
        color: PAINT, metalness: 0.78, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2,
    });
    const glassBlack = new THREE.MeshPhysicalMaterial({
        color: 0x0c0e11, metalness: 0.5, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03,
    });
    const trimBlack = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.2 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.12, metalness: 1 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.92 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.28, metalness: 0.9 });
    const rimDark = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.4, metalness: 0.8 });
    const disc = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.5, metalness: 0.9 });
    const caliper = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.4, metalness: 0.3 });
    const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe0f2fe, emissiveIntensity: 1.2 });
    const tail = new THREE.MeshPhysicalMaterial({ color: 0x5b0b0b, emissive: 0xdc2626, emissiveIntensity: 0.7, roughness: 0.15, clearcoat: 1 });
    const mesh = (geo, mat, parent = car) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true;
        parent.add(m);
        return m;
    };

    // Carrocería con planta redondeada y hombros; cabina de vidrio oscuro
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(), {
        depth: 1.62, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.1, bevelSegments: 10, curveSegments: 40,
    });
    bodyGeo.translate(0, 0, -0.81);
    mesh(deform(bodyGeo, (x, y) => shoulder(y) * plan(x)), paint);
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape(), {
        depth: 1.34, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.08, bevelSegments: 8, curveSegments: 32,
    });
    cabinGeo.translate(0, 0, -0.67);
    mesh(deform(cabinGeo, (x, y) => taper(y)), glassBlack);

    // Pasos de rueda oscuros (tapan el hueco del guardafango)
    [1.42, -1.42].forEach(x => {
        const well = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 40, 1, true, 0, Math.PI), trimBlack);
        well.rotation.x = Math.PI / 2;
        well.rotation.y = Math.PI / 2;
        well.position.set(x, 0.38, 0);
        well.material = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 1, side: THREE.DoubleSide });
    });

    // Ruedas: llanta de perfil bajo, rin de 5 radios dobles, disco y caliper
    [[1.42, 1], [1.42, -1], [-1.42, 1], [-1.42, -1]].forEach(([x, side]) => {
        const wheel = new THREE.Group();
        wheel.position.set(x, 0.4, side * 0.79);
        car.add(wheel);
        const tread = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.24, 48), rubber, wheel);
        tread.rotation.x = Math.PI / 2;
        [-1, 1].forEach(f => {
            const wall = mesh(new THREE.TorusGeometry(0.34, 0.065, 12, 48), rubber, wheel);
            wall.position.z = f * 0.11;
        });
        const face = side * 0.125;
        const barrel = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.2, 40, 1, true), rimDark, wheel);
        barrel.rotation.x = Math.PI / 2;
        const lip = mesh(new THREE.TorusGeometry(0.29, 0.016, 8, 48), rimMat, wheel);
        lip.position.z = face;
        const dsc = mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 32), disc, wheel);
        dsc.rotation.x = Math.PI / 2;
        dsc.position.z = face - side * 0.08;
        const cal = mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), caliper, wheel);
        cal.position.set(-0.13 * Math.sign(x), 0.13, face - side * 0.06);
        for (let i = 0; i < 5; i += 1) {
            [-0.12, 0.12].forEach(off => {
                const spoke = mesh(new THREE.BoxGeometry(0.035, 0.25, 0.025), rimMat, wheel);
                spoke.position.z = face;
                spoke.rotation.z = (i / 5) * Math.PI * 2 + off;
                spoke.translateY(0.15);
            });
        }
        const hub = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), rimMat, wheel);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = face + side * 0.01;
    });

    // Bajos negros (estribos, difusor y toma de aire), faros, barra de stops, espejos, manijas y molduras
    [-1, 1].forEach(side => {
        const rocker = mesh(new THREE.BoxGeometry(1.86, 0.08, 0.04), trimBlack);
        rocker.position.set(0, 0.33, side * 0.81);
        const head = mesh(new THREE.BoxGeometry(0.3, 0.05, 0.34), glassBlack);
        head.position.set(2.12, 0.76, side * 0.56);
        head.rotation.z = -0.42;
        head.rotation.y = side * 0.25;
        const strip = mesh(new THREE.BoxGeometry(0.28, 0.012, 0.3), led);
        strip.position.set(2.13, 0.785, side * 0.56);
        strip.rotation.z = -0.42;
        strip.rotation.y = side * 0.25;
        const mirrorArm = mesh(new THREE.BoxGeometry(0.1, 0.03, 0.08), trimBlack);
        mirrorArm.position.set(1.06, 1.03, side * 0.86);
        const mirror = mesh(new THREE.BoxGeometry(0.2, 0.11, 0.1), paint);
        mirror.position.set(1.02, 1.08, side * 0.94);
        mirror.geometry.translate(0, 0, 0);
        [0.62, -0.36].forEach(x => {
            const handle = mesh(new THREE.BoxGeometry(0.17, 0.022, 0.012), chrome);
            handle.position.set(x, 0.9, side * 0.875);
        });
        // Moldura cromada bajo las ventanas y unión de puertas
        const beltTrim = mesh(new THREE.BoxGeometry(2.38, 0.015, 0.012), chrome);
        beltTrim.position.set(-0.06, 1.02, side * 0.773);
        const seam = mesh(new THREE.BoxGeometry(0.008, 0.58, 0.006), trimBlack);
        seam.position.set(-0.02, 0.69, side * 0.873);
        const seam2 = mesh(new THREE.BoxGeometry(0.008, 0.5, 0.006), trimBlack);
        seam2.position.set(-0.85, 0.72, side * 0.873);
    });
    const tailBar = mesh(new THREE.BoxGeometry(0.06, 0.05, 1.4), tail);
    tailBar.position.set(-2.33, 0.87, 0);
    const diffuser = mesh(new THREE.BoxGeometry(0.14, 0.12, 1.26), trimBlack);
    diffuser.position.set(-2.28, 0.38, 0);
    const intake = mesh(new THREE.BoxGeometry(0.1, 0.12, 1.1), trimBlack);
    intake.position.set(2.31, 0.4, 0);

    // ---- Ventanas: cada una se pinta según el corte al que pertenece ----
    WINDOW_IDS.forEach(id => {
        const mat = new THREE.MeshPhysicalMaterial({
            color: FREE_GLASS, roughness: 0.32, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.25, envMapIntensity: 0.12,
            transparent: true, opacity: 0.9, side: THREE.DoubleSide, emissive: 0x000000,
        });
        const m = new THREE.Mesh(windowGeometry(id), mat);
        m.userData.window = id;
        m.renderOrder = 2;
        car.add(m);
        windowMeshes[id] = m;
    });

    car.add(contactShadow());
    car.position.y = 0.02;
    return car;
};

// Ángulo de cámara (azimut desde +X hacia +Z, elevación) para ver un grupo de ventanas
const viewFor = (windows) => {
    if (!windows?.length) return null;
    if (windows.every(w => w === 'sunroof')) return [0.9, 1.15];
    const first = windowCenter(windows[0]);
    const sameSide = windows.map(windowCenter).filter(c => Math.sign(c[2]) === Math.sign(first[2]));
    const cx = sameSide.reduce((s, c) => s + c[0], 0) / sameSide.length;
    const cz = sameSide.reduce((s, c) => s + c[2], 0) / sameSide.length;
    if (Math.abs(cz) < 0.05) return [cx > 0 ? 0.55 : Math.PI - 0.55, 0.55];
    return [Math.atan2(Math.sign(cz) * 1.6, cx * 0.6), 0.32];
};

/**
 * Carro en 3D que rota 360°. Cada zona/corte agrupa ventanas; se pintan según su estado.
 * Props:
 *  - zones: [{id, n, windows: [...]}] (por defecto, las zonas del técnico)
 *  - status { zoneId: 'pending' | 'done' | 'na' }, active (zoneId)
 *  - onSelect(zoneId) — al tocar una ventana de una zona; onSelectWindow(windowId) — al tocar una ventana libre
 */
export const Vehicle3D = ({ zones = DEFAULT_ZONES, status = {}, active, onSelect, onSelectWindow, className, hint }) => {
    const mountRef = useRef(null);
    const stateRef = useRef({});
    const handlers = useRef({});
    handlers.current = { onSelect, onSelectWindow, zones };
    const [unsupported, setUnsupported] = useState(false);
    const [spinning, setSpinning] = useState(true);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return undefined;
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
            setUnsupported(true);
            return undefined;
        }
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        mount.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.touchAction = 'none';

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
        const target = new THREE.Vector3(0, 0.78, 0);

        // Estudio: reflejos suaves en la pintura metalizada y el vidrio
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x1d2026, 0.55));
        const key = new THREE.DirectionalLight(0xffffff, 2.1);
        key.position.set(3, 9, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.left = -4; key.shadow.camera.right = 4;
        key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
        key.shadow.radius = 8;
        key.shadow.bias = -0.0005;
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xdbeafe, 0.9);
        rim.position.set(-7, 3, -4);
        scene.add(rim);
        const fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(5, 2, -6);
        scene.add(fill);

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.38 }));
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        const windowMeshes = {};
        const car = buildCar(windowMeshes);
        scene.add(car);
        const badges = new THREE.Group();
        car.add(badges);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(target);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 4.5;
        controls.maxDistance = 10;
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI / 2 - 0.06;
        controls.autoRotate = !reduceMotion;
        controls.autoRotateSpeed = 1.4;
        const placeCamera = (az, el, dist = CAMERA_DISTANCE) => {
            camera.position.set(
                target.x + dist * Math.cos(el) * Math.cos(az),
                target.y + dist * Math.sin(el),
                target.z + dist * Math.cos(el) * Math.sin(az),
            );
        };
        placeCamera(0.7, 0.36);
        controls.update();

        let resumeTimer = null;
        const pauseSpin = () => {
            controls.autoRotate = false;
            setSpinning(false);
            clearTimeout(resumeTimer);
        };
        const scheduleResume = () => {
            clearTimeout(resumeTimer);
            if (reduceMotion) return;
            resumeTimer = setTimeout(() => { controls.autoRotate = true; setSpinning(true); }, 5000);
        };
        controls.addEventListener('start', pauseSpin);
        controls.addEventListener('end', scheduleResume);

        // Animación suave de cámara hacia unas ventanas
        let focus = null;
        const focusView = (view) => {
            if (!view) return;
            const offset = camera.position.clone().sub(target);
            const sph = new THREE.Spherical().setFromVector3(offset);
            let goalTheta = Math.PI / 2 - view[0];
            const goalPhi = Math.PI / 2 - view[1];
            while (goalTheta - sph.theta > Math.PI) goalTheta -= Math.PI * 2;
            while (goalTheta - sph.theta < -Math.PI) goalTheta += Math.PI * 2;
            focus = { from: sph, theta: goalTheta, phi: goalPhi, t: 0 };
            pauseSpin();
            scheduleResume();
        };

        // Tocar una ventana (sin arrastrar): selecciona su zona/corte, o la ventana libre
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let downAt = null;
        const onDown = (e) => { downAt = [e.clientX, e.clientY]; };
        const onUp = (e) => {
            if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster.intersectObjects([car], true)[0];
            const zoneId = hit?.object.userData.zone;
            const win = hit?.object.userData.window;
            if (zoneId) { handlers.current.onSelect?.(zoneId); return; }
            if (!win) return;
            const owner = handlers.current.zones.find(z => z.windows?.includes(win));
            if (owner) handlers.current.onSelect?.(owner.id);
            else handlers.current.onSelectWindow?.(win);
        };
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointerup', onUp);

        const resize = () => {
            const w = mount.clientWidth || 600;
            const h = Math.max(220, Math.min(380, Math.round(w * 0.56)));
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(mount);

        let raf = 0;
        const tick = () => {
            raf = requestAnimationFrame(tick);
            if (focus) {
                focus.t = Math.min(1, focus.t + 0.04);
                const k = 1 - (1 - focus.t) ** 3;
                const sph = new THREE.Spherical(
                    focus.from.radius + (CAMERA_DISTANCE - focus.from.radius) * k,
                    focus.from.phi + (focus.phi - focus.from.phi) * k,
                    focus.from.theta + (focus.theta - focus.from.theta) * k,
                );
                camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
                if (focus.t >= 1) focus = null;
            }
            controls.update();
            renderer.render(scene, camera);
        };
        tick();

        stateRef.current = { windowMeshes, badges, focusView, setAuto: (on) => { controls.autoRotate = on; setSpinning(on); } };

        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(resumeTimer);
            ro.disconnect();
            controls.dispose();
            renderer.domElement.removeEventListener('pointerdown', onDown);
            renderer.domElement.removeEventListener('pointerup', onUp);
            scene.traverse(obj => {
                obj.geometry?.dispose?.();
                const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
                mats.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
            });
            scene.environment?.dispose();
            pmrem.dispose();
            renderer.dispose();
            mount.removeChild(renderer.domElement);
            stateRef.current = {};
        };
    }, []);

    // Colores de cada ventana según su zona/corte, y números sobre cada grupo
    const zonesKey = JSON.stringify(zones.map(z => [z.id, z.n, z.windows]));
    useEffect(() => {
        const { windowMeshes, badges } = stateRef.current;
        if (!windowMeshes) return;
        const owner = {};
        zones.forEach(z => (z.windows || []).forEach(w => { owner[w] = z; }));
        WINDOW_IDS.forEach(w => {
            const mat = windowMeshes[w].material;
            const z = owner[w];
            const isActive = z && active === z.id;
            const st = z ? (status[z.id] || 'pending') : null;
            const color = isActive ? ACTIVE_COLOR : z ? ZONE_COLORS[st] : FREE_GLASS;
            // Vidrio polarizado: base oscura con reflejos, y el color del estado como brillo propio
            // (no depende de la luz, así se ve igual a ambos lados del carro)
            mat.color.setHex(color).lerp(GLASS_TINT, 0.78);
            mat.emissive.setHex(z && st !== 'na' ? color : 0x000000);
            mat.emissiveIntensity = isActive ? 0.75 : 0.48;
            mat.opacity = !z ? 0.9 : st === 'na' && !isActive ? 0.5 : 0.86;
        });
        // Números: uno por zona y por lado del carro (en el centro de sus ventanas de ese lado)
        badges.children.slice().forEach(b => { badges.remove(b); b.material.map?.dispose(); b.material.dispose(); });
        zones.forEach(z => {
            const groups = {};
            (z.windows || []).forEach(w => {
                const c = windowCenter(w);
                const k = Math.abs(c[2]) < 0.05 ? 'c' : c[2] > 0 ? 'r' : 'l';
                (groups[k] = groups[k] || []).push(c);
            });
            Object.values(groups).forEach(cs => {
                const sprite = labelSprite(z.n);
                sprite.position.set(cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length + 0.05,
                    cs.reduce((s, c) => s + c[2], 0) / cs.length);
                sprite.userData.zone = z.id;
                badges.add(sprite);
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zonesKey, status, active]);

    // Girar la cámara hacia la zona elegida
    useEffect(() => {
        const z = zones.find(x => x.id === active);
        if (z) stateRef.current.focusView?.(viewFor(z.windows));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    if (unsupported) {
        return (
            <div className={`p-6 text-center text-sm text-slate-300 ${className || ''}`}>
                Este dispositivo no puede mostrar el carro en 3D. Coloca las medidas en las zonas de abajo.
            </div>
        );
    }

    return (
        <div className={`relative ${className || ''}`}>
            <div ref={mountRef} className="w-full cursor-grab active:cursor-grabbing" data-testid="vehicle-3d" />
            <button
                type="button"
                onClick={() => stateRef.current.setAuto?.(!spinning)}
                className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 text-[11px] text-slate-200 hover:bg-black/70"
                data-testid="vehicle-3d-spin"
            >
                <RotateCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin [animation-duration:3s]' : ''}`} />
                {spinning ? 'Girando 360°' : 'Girar'}
            </button>
            <p className="absolute bottom-2 left-2 text-[11px] text-slate-400 pointer-events-none">
                {hint || 'Arrastra para girar · toca un vidrio para medirlo'}
            </p>
        </div>
    );
};

export default Vehicle3D;
