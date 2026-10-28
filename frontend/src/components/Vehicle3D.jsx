import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RotateCw } from 'lucide-react';

import { MEASURE_ZONES } from '../lib/measureZones';

const ZONE_COLORS = { pending: 0xf59e0b, done: 0x10b981, na: 0x475569 };
const ACTIVE_COLOR = 0x22d3ee;
const PEARL_WHITE = 0xeef0f2;
const GLASS_BLACK = 0x15171b;

// El carro mira hacia +X; +Z es el lado derecho (copiloto) y -Z el izquierdo (piloto).
// Ángulo de cámara (azimut, elevación) para enfocar cada zona.
const ZONE_VIEWS = {
    panoramico: [0.55, 0.55],
    trasero: [Math.PI - 0.55, 0.55],
    laterales_izquierdo: [-Math.PI / 2 + 0.25, 0.3],
    laterales_derecho: [Math.PI / 2 - 0.25, 0.3],
    sunroof: [0.9, 1.15],
};
const CAMERA_DISTANCE = 7.2;

// ---------- geometría (sedán eléctrico tipo Tesla Model 3) ----------
const BELT = 0.98; // línea de cintura donde empieza la cabina
// La cabina se angosta hacia el techo
const taper = (y) => 1 - Math.max(0, y - BELT) * 0.5;
const taperGeometry = (geo) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        pos.setZ(i, pos.getZ(i) * taper(pos.getY(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
};

// Perfil lateral de la carrocería: nariz redonda sin parrilla, capó largo y bajo, baúl corto con labio (ducktail)
const bodyShape = () => {
    const s = new THREE.Shape();
    s.moveTo(-2.24, 0.36);
    s.quadraticCurveTo(-2.36, 0.52, -2.33, 0.74);
    s.quadraticCurveTo(-2.3, 0.9, -2.2, 0.95);
    s.lineTo(-1.55, BELT);
    s.lineTo(1.25, BELT);
    s.quadraticCurveTo(1.85, 0.93, 2.14, 0.76);
    s.quadraticCurveTo(2.36, 0.64, 2.32, 0.46);
    s.quadraticCurveTo(2.28, 0.32, 2.12, 0.3);
    s.lineTo(1.88, 0.3);
    s.absarc(1.42, 0.38, 0.46, 0, Math.PI, false);
    s.lineTo(-0.96, 0.3);
    s.absarc(-1.42, 0.38, 0.46, 0, Math.PI, false);
    s.lineTo(-2.24, 0.3);
    return s;
};

// Cabina fastback: parabrisas → techo de vidrio → vidrio trasero largo
const cabinShape = () => {
    const s = new THREE.Shape();
    s.moveTo(-1.55, BELT);
    s.quadraticCurveTo(-0.95, 1.28, -0.45, 1.47);
    s.quadraticCurveTo(-0.02, 1.53, 0.4, 1.47);
    s.lineTo(1.25, BELT);
    s.closePath();
    return s;
};

// Hombros redondeados: la carrocería se angosta un poco hacia la línea de cintura
const shoulder = (y) => 1 - Math.max(0, y - 0.62) * 0.22;
const shoulderGeometry = (geo) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        pos.setZ(i, pos.getZ(i) * shoulder(pos.getY(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
};

const quad = (a, b, c, d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    return g;
};

// Vidrio que sigue una curva cuadrática del perfil (p. ej. el vidrio trasero fastback),
// desplazado hacia afuera; el medio ancho pasa de zFrom a zTo a lo largo de la curva.
const curvedPanel = (p0, ctrl, p1, offset, zFrom, zTo, t0 = 0.06, t1 = 0.96, steps = 12) => {
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

const numberSprite = (n) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(32, 32, 25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.scale.set(0.3, 0.3, 0.3);
    sprite.renderOrder = 10;
    return sprite;
};

const buildCar = (zoneMeshes) => {
    const car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
        color: PEARL_WHITE, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08,
    });
    const blackGlass = new THREE.MeshPhysicalMaterial({
        color: GLASS_BLACK, roughness: 0.12, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05,
    });
    const tire = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.9 });
    const aero = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.45, metalness: 0.6 });
    const aeroLight = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.35, metalness: 0.7 });
    const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdbeafe, emissiveIntensity: 0.9 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xb91c1c, emissiveIntensity: 0.5, roughness: 0.3 });
    const mesh = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true;
        car.add(m);
        return m;
    };

    // Carrocería (bordes muy redondeados) y cabina negra tipo Tesla
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(), {
        depth: 1.58, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.14, bevelSegments: 8, curveSegments: 28,
    });
    bodyGeo.translate(0, 0, -0.79);
    mesh(shoulderGeometry(bodyGeo), paint);
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape(), {
        depth: 1.34, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.09, bevelSegments: 6, curveSegments: 24,
    });
    cabinGeo.translate(0, 0, -0.67);
    mesh(taperGeometry(cabinGeo), blackGlass);

    // Rines aero tipo Tesla
    [[1.42, 0.8], [1.42, -0.8], [-1.42, 0.8], [-1.42, -0.8]].forEach(([x, z]) => {
        const side = Math.sign(z);
        const t = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 48), tire);
        t.rotation.x = Math.PI / 2;
        t.position.set(x, 0.4, z);
        const rim = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.03, 48), aero);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, 0.4, z + side * 0.135);
        const ring = mesh(new THREE.TorusGeometry(0.24, 0.018, 8, 48), aeroLight);
        ring.position.set(x, 0.4, z + side * 0.152);
        for (let i = 0; i < 4; i += 1) {
            const slot = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.01), tire);
            slot.position.set(x, 0.4, z + side * 0.152);
            slot.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
            slot.translateY(0.15);
        }
        const hub = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), aeroLight);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(x, 0.4, z + side * 0.16);
    });

    // Faros LED delgados, stops envolventes, espejos y manijas al ras
    [-1, 1].forEach(side => {
        const head = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.3), blackGlass);
        head.position.set(2.14, 0.76, side * 0.6);
        head.rotation.z = -0.35;
        const strip = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.26), led);
        strip.position.set(2.15, 0.79, side * 0.6);
        strip.rotation.z = -0.35;
        const tl = mesh(new THREE.BoxGeometry(0.08, 0.07, 0.42), tail);
        tl.position.set(-2.28, 0.86, side * 0.58);
        const tlSide = mesh(new THREE.BoxGeometry(0.22, 0.06, 0.03), tail);
        tlSide.position.set(-2.16, 0.86, side * 0.86);
        const mirror = mesh(new THREE.SphereGeometry(0.09, 16, 12), paint);
        mirror.scale.set(1.3, 0.8, 1);
        mirror.position.set(1.08, 1.06, side * 0.88);
        [0.6, -0.4].forEach(x => {
            const handle = mesh(new THREE.BoxGeometry(0.18, 0.025, 0.01), blackGlass);
            handle.position.set(x, 0.88, side * 0.882);
        });
    });
    // Difusor trasero oscuro
    const diffuser = mesh(new THREE.BoxGeometry(0.1, 0.1, 1.3), blackGlass);
    diffuser.position.set(-2.28, 0.4, 0);

    // ---- Zonas de vidrio (se pintan según el estado de la medida) ----
    const glassMat = () => new THREE.MeshStandardMaterial({
        color: ZONE_COLORS.pending, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    });
    const addZone = (id, geos, badgePos) => {
        const mat = glassMat();
        geos.forEach(g => {
            const m = new THREE.Mesh(g, mat);
            m.userData.zone = id;
            car.add(m);
            zoneMeshes.meshes.push(m);
        });
        zoneMeshes.materials[id] = mat;
        const badge = numberSprite(MEASURE_ZONES.find(z => z.id === id).n);
        badge.position.set(...badgePos);
        badge.userData.zone = id;
        car.add(badge);
        zoneMeshes.meshes.push(badge);
    };

    // Vidrios inclinados: un poco por fuera de la cabina; medio ancho abajo y arriba
    const zB = 0.66;
    const zT = 0.5;
    addZone('panoramico', [quad([1.31, 1.01, -zB], [1.31, 1.01, zB], [0.45, 1.515, zT], [0.45, 1.515, -zT])], [0.92, 1.32, 0]);
    addZone('trasero', [curvedPanel([-1.55, BELT], [-0.95, 1.28], [-0.45, 1.47], 0.075, zB, zT)], [-0.98, 1.38, 0]);
    // Techo de vidrio (sunroof)
    addZone('sunroof', [quad([-0.4, 1.575, -0.38], [-0.4, 1.575, 0.38], [0.32, 1.578, 0.38], [0.32, 1.578, -0.38])], [-0.04, 1.65, 0]);

    // Ventanas laterales: delantera, trasera (con la caída fastback)
    const sideWindows = () => [
        flatShape([[1.12, 1.03], [0.4, 1.42], [0.02, 1.43], [0.02, 1.03]]),
        flatShape([[-0.06, 1.03], [-0.06, 1.43], [-0.5, 1.41], [-1.17, 1.07], [-1.24, 1.03]]),
    ];
    const zSide = 0.765;
    const zBadge = (zSide + 0.08) * taper(1.24);
    const right = sideWindows();
    right.forEach(g => taperGeometry(g.translate(0, 0, zSide)));
    addZone('laterales_derecho', right, [0.15, 1.24, zBadge]);
    const left = sideWindows();
    left.forEach(g => taperGeometry(g.translate(0, 0, -zSide)));
    addZone('laterales_izquierdo', left, [0.15, 1.24, -zBadge]);

    car.position.y = 0.02;
    return car;
};

/**
 * Carro en 3D que rota 360°. Las zonas de vidrio se pueden tocar y se pintan según su estado.
 * Props: status { zoneId: 'pending' | 'done' | 'na' }, active (zoneId), onSelect(zoneId)
 */
export const Vehicle3D = ({ status = {}, active, onSelect, className }) => {
    const mountRef = useRef(null);
    const stateRef = useRef({});
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
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
        mount.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.touchAction = 'none';

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
        const target = new THREE.Vector3(0, 0.8, 0);

        // Reflejos de estudio para la pintura perlada y el vidrio negro
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2d33, 0.7));
        const key = new THREE.DirectionalLight(0xffffff, 1.8);
        key.position.set(4, 8, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -4; key.shadow.camera.right = 4;
        key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
        key.shadow.radius = 6;
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xffffff, 0.6);
        rim.position.set(-6, 4, -5);
        scene.add(rim);

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.45 }));
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        const zoneMeshes = { meshes: [], materials: {} };
        const car = buildCar(zoneMeshes);
        scene.add(car);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(target);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 4.5;
        controls.maxDistance = 10;
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        controls.autoRotate = !reduceMotion;
        controls.autoRotateSpeed = 1.6;
        const placeCamera = (az, el, dist = CAMERA_DISTANCE) => {
            camera.position.set(
                target.x + dist * Math.cos(el) * Math.cos(az),
                target.y + dist * Math.sin(el),
                target.z + dist * Math.cos(el) * Math.sin(az),
            );
        };
        placeCamera(0.7, 0.42);
        controls.update();

        // Reanuda el giro unos segundos después de que el usuario suelte el carro
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

        // Animación suave de cámara hacia una zona
        let focus = null;
        const focusZone = (zoneId) => {
            const view = ZONE_VIEWS[zoneId];
            if (!view) return;
            const offset = camera.position.clone().sub(target);
            const sph = new THREE.Spherical().setFromVector3(offset);
            // Spherical de three: theta desde +Z hacia +X; convertimos el azimut (desde +X hacia +Z)
            let goalTheta = Math.PI / 2 - view[0];
            const goalPhi = Math.PI / 2 - view[1];
            while (goalTheta - sph.theta > Math.PI) goalTheta -= Math.PI * 2;
            while (goalTheta - sph.theta < -Math.PI) goalTheta += Math.PI * 2;
            focus = { from: sph, theta: goalTheta, phi: goalPhi, t: 0 };
            pauseSpin();
            scheduleResume();
        };

        // Tocar una zona (sin arrastrar) la selecciona
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let downAt = null;
        const onDown = (e) => { downAt = [e.clientX, e.clientY]; };
        const onUp = (e) => {
            if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster.intersectObjects([car], true).find(h => h.object.userData.zone || h.object.type === 'Mesh');
            if (hit?.object.userData.zone) onSelectRef.current?.(hit.object.userData.zone);
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

        stateRef.current = { zoneMeshes, focusZone, controls, setAuto: (on) => { controls.autoRotate = on; setSpinning(on); } };

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

    // Colores según el estado de cada zona y la zona activa
    useEffect(() => {
        const mats = stateRef.current.zoneMeshes?.materials || {};
        MEASURE_ZONES.forEach(z => {
            const mat = mats[z.id];
            if (!mat) return;
            const isActive = active === z.id;
            mat.color.setHex(isActive ? ACTIVE_COLOR : ZONE_COLORS[status[z.id] || 'pending']);
            mat.emissive.setHex(isActive ? 0x0e7490 : 0x000000);
            mat.opacity = status[z.id] === 'na' && !isActive ? 0.55 : 0.92;
        });
    }, [status, active]);

    // Girar la cámara hacia la zona elegida
    useEffect(() => {
        if (active) stateRef.current.focusZone?.(active);
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
                Arrastra para girar · toca un vidrio para medirlo
            </p>
        </div>
    );
};

export default Vehicle3D;
