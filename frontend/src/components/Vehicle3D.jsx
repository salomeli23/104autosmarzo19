import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCw } from 'lucide-react';

import { MEASURE_ZONES } from '../lib/measureZones';

const ZONE_COLORS = { pending: 0xf59e0b, done: 0x10b981, na: 0x475569 };
const ACTIVE_COLOR = 0x22d3ee;
const CLAY = 0xc8cacd;

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

// ---------- geometría ----------
// La cabina se angosta hacia el techo (como un carro real)
const taper = (y) => 1 - Math.max(0, y - 1.0) * 0.45;
const taperGeometry = (geo, extraZ = 0) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const y = pos.getY(i);
        const z = pos.getZ(i);
        pos.setZ(i, Math.sign(z) * (Math.abs(z) + extraZ) * taper(y));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
};
const extrudeProfile = (points, depth, bevel) => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel * 1.4, bevelSegments: 5, curveSegments: 16,
    });
    geo.translate(0, 0, -depth / 2);
    geo.computeVertexNormals();
    return geo;
};

const bodyShape = () => {
    // Perfil lateral de la carrocería con los pasos de rueda
    const s = new THREE.Shape();
    s.moveTo(-2.22, 0.42);
    s.lineTo(-2.28, 0.72);
    s.quadraticCurveTo(-2.26, 0.95, -2.1, 0.98);
    s.lineTo(-1.42, 1.02);
    s.lineTo(1.16, 1.0);
    s.quadraticCurveTo(1.9, 0.92, 2.2, 0.8);
    s.quadraticCurveTo(2.32, 0.7, 2.3, 0.5);
    s.lineTo(2.22, 0.34);
    s.lineTo(1.82, 0.32);
    s.absarc(1.36, 0.36, 0.46, 0, Math.PI, false);
    s.lineTo(-0.9, 0.32);
    s.absarc(-1.36, 0.36, 0.46, 0, Math.PI, false);
    s.lineTo(-2.22, 0.34);
    return s;
};

const quad = (a, b, c, d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
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
    sprite.scale.set(0.32, 0.32, 0.32);
    sprite.renderOrder = 10;
    sprite.material.depthTest = true;
    return sprite;
};

const buildCar = (zoneMeshes) => {
    const car = new THREE.Group();
    const clay = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.62, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xb0b3b8, roughness: 0.45, metalness: 0.2 });
    const mesh = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true;
        car.add(m);
        return m;
    };

    // Carrocería y cabina
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(), {
        depth: 1.62, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.1, bevelSegments: 6, curveSegments: 20,
    });
    bodyGeo.translate(0, 0, -0.81);
    bodyGeo.computeVertexNormals();
    mesh(bodyGeo, clay);
    mesh(taperGeometry(extrudeProfile([[-1.42, 1.0], [-0.98, 1.43], [0.42, 1.46], [1.16, 1.0]], 1.36, 0.06)), clay);

    // Llantas, rines y ejes
    [[1.36, 0.82], [1.36, -0.82], [-1.36, 0.82], [-1.36, -0.82]].forEach(([x, z]) => {
        const tire = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 40), dark);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(x, 0.4, z);
        const side = Math.sign(z);
        const rim = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 32), trim);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, 0.4, z + side * 0.14);
        for (let i = 0; i < 5; i += 1) {
            const spoke = mesh(new THREE.BoxGeometry(0.05, 0.24, 0.02), clay);
            spoke.position.set(x, 0.4, z + side * 0.16);
            spoke.rotation.z = (i / 5) * Math.PI * 2;
            spoke.translateY(0.11);
        }
        const hub = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), clay);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(x, 0.4, z + side * 0.17);
    });

    // Espejos, faros, stops, manijas y parachoques
    [-1, 1].forEach(side => {
        const mirror = mesh(new THREE.BoxGeometry(0.16, 0.11, 0.16), clay);
        mirror.position.set(0.98, 1.08, side * 0.93);
        const arm = mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), clay);
        arm.position.set(1.0, 1.04, side * 0.84);
        const head = mesh(new THREE.BoxGeometry(0.08, 0.1, 0.36), trim);
        head.position.set(2.24, 0.78, side * 0.55);
        const tail = mesh(new THREE.BoxGeometry(0.06, 0.12, 0.36), new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.5 }));
        tail.position.set(-2.3, 0.82, side * 0.56);
        [0.55, -0.45].forEach(x => {
            const handle = mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), trim);
            handle.position.set(x, 0.92, side * 0.92);
        });
    });
    const grille = mesh(new THREE.BoxGeometry(0.05, 0.12, 0.6), dark);
    grille.position.set(2.31, 0.6, 0);
    const plate = mesh(new THREE.BoxGeometry(0.04, 0.16, 0.42), trim);
    plate.position.set(-2.36, 0.62, 0);

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

    // Medio ancho de los vidrios inclinados: abajo y arriba (sigue el angostamiento de la cabina)
    const zB = 0.66;
    const zT = 0.5;
    addZone('panoramico', [quad([1.205, 1.03, -zB], [1.205, 1.03, zB], [0.47, 1.5, zT], [0.47, 1.5, -zT])], [0.9, 1.3, 0]);
    addZone('trasero', [quad([-1.465, 1.03, zB], [-1.465, 1.03, -zB], [-1.0, 1.48, -zT], [-1.0, 1.48, zT])], [-1.26, 1.3, 0]);
    addZone('sunroof', [quad([-0.6, 1.535, -0.36], [-0.6, 1.535, 0.36], [0.2, 1.545, 0.36], [0.2, 1.545, -0.36])], [-0.2, 1.6, 0]);

    // Ventanas laterales: puerta delantera, puerta trasera y custodia
    const sideWindows = () => [
        flatShape([[1.04, 1.04], [0.42, 1.4], [-0.02, 1.41], [-0.02, 1.04]]),
        flatShape([[-0.12, 1.04], [-0.12, 1.41], [-0.82, 1.4], [-1.08, 1.17], [-1.08, 1.04]]),
        flatShape([[-1.15, 1.04], [-1.15, 1.13], [-1.33, 1.04]]),
    ];
    // Sobre la cara lateral de la cabina (0.764 de medio ancho) y con su misma inclinación
    const zSide = 0.776;
    const zBadge = (zSide + 0.08) * taper(1.24);
    const right = sideWindows();
    right.forEach(g => taperGeometry(g.translate(0, 0, zSide)));
    addZone('laterales_derecho', right, [0.2, 1.24, zBadge]);
    const left = sideWindows();
    left.forEach(g => taperGeometry(g.translate(0, 0, -zSide)));
    addZone('laterales_izquierdo', left, [0.2, 1.24, -zBadge]);

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

        scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2d33, 1.1));
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
