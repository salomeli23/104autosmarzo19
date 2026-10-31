import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { MEASURE_ZONES, zonesInMeasurements } from '../lib/measureZones';
import { LinearMeasureInput, formatLinear } from './LinearMeasureInput';
import { TechMeasurementsSummary, zoneText } from './TechMeasurements';
import { zoneOpacityText } from '../lib/opacity';
import { cuttingAPI, inventoryAPI, cuttingCatalogAPI } from '../lib/api';
import { toast } from 'sonner';
import { Scissors, Plus, Trash2, Recycle, CheckCircle2, ArrowLeft, Gauge, AlertTriangle } from 'lucide-react';
import { TypeAheadSelect } from './TypeAheadSelect';

const Vehicle3D = React.lazy(() => import('./Vehicle3D'));

// (máx. materiales, máx. rollos) por zona — igual que ZONE_CUT_LIMITS en el backend
const ZONE_LIMITS = {
    panoramico: [1, 1],
    trasero: [1, 1],
    laterales_delanteros: [3, 2],
    laterales_traseros: [3, 2],
    laterales_izquierdo: [3, 2],
    laterales_derecho: [3, 2],
    sunroof: [1, 1],
};
const limitText = (zone) => {
    const [m, r] = ZONE_LIMITS[zone];
    return m === 1 ? '1 material · 1 rollo' : `Hasta ${m} materiales · ${r} rollos`;
};
const selectClass = 'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';
const fmtM = (m) => `${(Math.round(m * 100) / 100).toFixed(2).replace('.', ',')} m`;

let lineKey = 1;
const newLine = (cm = '') => ({ key: `l${lineKey++}`, material: '', inventory_item_id: '', reusable_piece_id: '', cm });
// PPF: "ppf_full" = un corte aproximado para todo el carro; "ppf:<parte>" = corte lineal de cada parte comprada
const PPF_FULL = 'ppf_full';
const isPpfKey = (k) => k === PPF_FULL || k.startsWith('ppf:');
const ppfKeysFor = (plan) => !plan ? [] : plan.scope === 'full' ? [PPF_FULL] : (plan.parts || []).map(p => `ppf:${p}`);
const ppfLabel = (k) => (k === PPF_FULL ? 'Todo el carro · corte aproximado' : k.slice(4));
// Nombre grande del servicio comprado: "Polarizado Ceramic i3", "PPF Full body · Brillante"…
// La descripción llega como "Categoría - Servicio": la categoría va en la etiqueta pequeña
const splitService = (s) => {
    const full = s.name || s.service || 'Servicio';
    const i = full.indexOf(' - ');
    return i > 0 ? { category: full.slice(0, i), name: full.slice(i + 3) } : { category: null, name: full };
};
const serviceTitle = (s) => {
    const { name } = splitService(s);
    const low = name.toLowerCase();
    const extra = [s.film_label && !low.includes(String(s.film_label).toLowerCase()) ? s.film_label : null,
        s.ppf_scope === 'full' && !low.includes('full') ? 'Full' : null,
        s.ppf_scope === 'partes' && !low.includes('parte') ? 'Por partes' : null,
        s.ppf_finish, s.ppf_color].filter(Boolean);
    return extra.length ? `${name} · ${extra.join(' · ')}` : name;
};
const serviceKind = (s) => {
    const t = `${s.name || ''} ${s.service || ''}`.toLowerCase();
    if (s.ppf_scope || t.includes('ppf')) return 'ppf';
    if (t.includes('ultrasecure') || t.includes('seguridad')) return 'ultrasecure';
    return 'polarizado';
};
const KIND_STYLE = {
    polarizado: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300',
    ultrasecure: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
    ppf: 'border-purple-500/50 bg-purple-500/10 text-purple-300',
};
const KIND_LABEL = { polarizado: 'Polarizado', ultrasecure: 'Ultrasecure', ppf: 'PPF' };
const pieceSize = (p) => `${p.largo_cm}${p.ancho_cm ? ` × ${p.ancho_cm}` : ''} cm`;

const orderHasPPF = (order) => (order?.cutting_services || order?.services || []).some(s => {
    const txt = `${s.name || ''} ${s.description || ''} ${s.service || ''}`.toLowerCase();
    return txt.includes('ppf') || txt.includes('proteccion') || txt.includes('protección');
});

/** Alerta de piezas reutilizables de la referencia elegida: permite cortar de una pieza en vez del rollo */
const ReusablePiecesAlert = ({ line, options, piece, onUse, onRelease, testId }) => {
    if (piece) {
        return (
            <div className="sm:col-span-4 flex flex-wrap items-center gap-2 text-xs p-2 rounded-md border border-emerald-500/50 bg-emerald-500/10" data-testid={testId}>
                <Recycle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="flex-1 min-w-0">Cortando de la pieza reutilizable <b>{piece.codigo}</b> ({pieceSize(piece)}) · no descuenta del rollo</span>
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={(e) => { e.stopPropagation(); onRelease(); }}>Usar rollo</Button>
            </div>
        );
    }
    if (!options.length) return null;
    const fitting = options.filter(p => p.fits);
    return (
        <div className="sm:col-span-4 text-xs p-2 rounded-md border border-amber-500/50 bg-amber-500/10 space-y-1.5" data-testid={testId}>
            <p className="flex items-center gap-1.5 font-medium text-amber-300">
                <Recycle className="w-4 h-4 shrink-0" />
                ♻ Hay {options.length} pieza(s) reutilizable(s) de {line.material}
                {parseFloat(line.cm) > 0 ? ` · ${fitting.length} alcanza(n) para ${formatLinear(parseFloat(line.cm))}` : ''}. Úsala antes de cortar del rollo.
            </p>
            <div className="flex flex-wrap gap-1.5">
                {options.slice(0, 6).map(p => (
                    <button key={p.id} type="button" onClick={(e) => { e.stopPropagation(); onUse(p); }}
                        className={`px-2 py-1 rounded border ${p.fits ? 'border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/15' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
                        title={p.notes || ''} data-testid={`use-piece-${p.codigo}`}>
                        Usar {p.codigo} · {pieceSize(p)}{p.fits ? '' : ' (corta)'}
                    </button>
                ))}
            </div>
        </div>
    );
};

/**
 * Completar corte con las medidas del técnico: por zona se elige material, rollo y metros
 * (se descuentan del inventario). Antes de confirmar se pregunta qué cortes fueron reutilizables.
 * Props: order (null para cerrar), onClose(), onCompleted()
 */
export const CompleteCuttingDialog = ({ order, onClose, onCompleted }) => {
    const [cuts, setCuts] = useState({});
    const [active, setActive] = useState(null);
    const [step, setStep] = useState('form');
    const [reuse, setReuse] = useState({});
    const [notes, setNotes] = useState('');
    const [ppfSerial, setPpfSerial] = useState('');
    const [ppfModel, setPpfModel] = useState('');
    const [rolls, setRolls] = useState([]);
    const [pieces, setPieces] = useState([]);
    const [catalog, setCatalog] = useState(null);
    const [carAverage, setCarAverage] = useState(null);
    const [saving, setSaving] = useState(false);

    const tm = useMemo(() => order?.tech_measurements || {}, [order]);
    // Incluye las zonas anteriores (laterales por lado) si el técnico midió con ellas
    const allZones = useMemo(() => zonesInMeasurements(tm), [tm]);
    const zones = useMemo(() => allZones.filter(z => tm[z.id] && tm[z.id].aplica !== false), [allZones, tm]);
    const ppfPlan = order?.ppf_plan || null;
    const ppfKeys = useMemo(() => ppfKeysFor(ppfPlan), [ppfPlan]);
    const cutKeys = [...zones.map(z => z.id), ...ppfKeys];

    useEffect(() => {
        if (!order) return;
        const init = {};
        zonesInMeasurements(tm).forEach(z => {
            const t = tm[z.id];
            if (t && t.aplica !== false) init[z.id] = [newLine(t.medida_cm || '')];
        });
        ppfKeysFor(order.ppf_plan).forEach(k => { init[k] = [newLine()]; });
        setCuts(init);
        setActive(Object.keys(init).find(k => !isPpfKey(k)) || null);
        setStep('form');
        setReuse({});
        setNotes('');
        setPpfSerial(order.ppf_vehicle_serial || '');
        setPpfModel(order.ppf_vehicle_model || '');
        inventoryAPI.list({ tipo_articulo: 'rollo' })
            // Solo rollos activos en el stock de corte (los de bodega se activan desde Inventario)
            // Ordenados por referencia: en el select se escoge escribiendo las primeras letras
            .then(res => setRolls((res.data || [])
                .filter(r => (r.metros_restantes ?? 0) > 0 && r.en_stock_corte !== false)
                .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }) || (a.seq || 0) - (b.seq || 0))))
            .catch(() => setRolls([]));
        cuttingAPI.reusablePieces().then(res => setPieces(res.data || [])).catch(() => setPieces([]));
        if (!catalog) cuttingCatalogAPI.getMaterials().then(res => setCatalog(res.data)).catch(() => {});
        cuttingCatalogAPI.getCarAverage(order.brand || '', order.model || '')
            .then(res => setCarAverage(res.data?.found ? res.data : null))
            .catch(() => setCarAverage(null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    if (!order) return null;

    const isPPF = orderHasPPF(order);
    const rollById = (id) => rolls.find(r => r.id === id);
    const pieceById = (id) => pieces.find(p => p.id === id);
    // Cada referencia tiene su rollo: cambia con el material salvo que el cortador haya elegido otro rollo a mano
    const rollForMaterial = (l, material) => {
        const current = rollById(l.inventory_item_id);
        if (l.inventory_item_id && current && current.tipo_rollo !== l.material) return l.inventory_item_id;
        return rolls.find(r => r.tipo_rollo === material)?.id || '';
    };
    const usedPieceIds = new Set(cutKeys.flatMap(k => (cuts[k] || []).map(l => l.reusable_piece_id).filter(Boolean)));
    // Piezas reutilizables de la referencia que sirven para la línea: primero las que alcanzan el largo
    const piecesFor = (l) => pieces
        .filter(p => p.referencia === l.material && (!usedPieceIds.has(p.id) || p.id === l.reusable_piece_id))
        .map(p => ({ ...p, fits: !(parseFloat(l.cm) > 0) || p.largo_cm >= parseFloat(l.cm) }))
        .sort((a, b) => (b.fits - a.fits) || a.largo_cm - b.largo_cm);
    const allLines = cutKeys.flatMap(k => (cuts[k] || []).map(l => ({ ...l, zone: k })));
    const lineTitle = (k) => {
        if (isPpfKey(k)) return `PPF · ${ppfLabel(k)}`;
        const z = allZones.find(x => x.id === k);
        return z ? `${z.n}. ${z.label}` : k;
    };

    const zoneDone = (zoneId) => {
        const ls = cuts[zoneId] || [];
        return ls.length > 0 && ls.every(l => l.material && parseFloat(l.cm) > 0);
    };
    const status = Object.fromEntries(MEASURE_ZONES.map(z => [
        z.id, !tm[z.id] || tm[z.id].aplica === false ? 'na' : zoneDone(z.id) ? 'done' : 'pending',
    ]));

    const updateLine = (zone, key, changes) => setCuts(prev => ({
        ...prev, [zone]: prev[zone].map(l => (l.key === key ? { ...l, ...changes } : l)),
    }));
    const addLine = (zone) => setCuts(prev => ({ ...prev, [zone]: [...prev[zone], newLine()] }));
    const removeLine = (zone, key) => setCuts(prev => ({ ...prev, [zone]: prev[zone].filter(l => l.key !== key) }));

    const zoneRollError = (zone) => {
        if (!ZONE_LIMITS[zone]) return null;
        const [, maxRolls] = ZONE_LIMITS[zone];
        const used = new Set((cuts[zone] || []).map(l => l.inventory_item_id).filter(Boolean));
        return used.size > maxRolls ? `Máximo ${maxRolls} rollo(s) en esta zona` : null;
    };

    const goConfirm = () => {
        if (allLines.length === 0) {
            toast.error('No hay zonas con medidas del técnico ni PPF para cortar');
            return;
        }
        const missing = allLines.find(l => !l.material || !(parseFloat(l.cm) > 0));
        if (missing) {
            if (!isPpfKey(missing.zone)) setActive(missing.zone);
            toast.error(`Completa material y metros en ${lineTitle(missing.zone)}`);
            return;
        }
        const rollErr = zones.find(z => zoneRollError(z.id));
        if (rollErr) {
            setActive(rollErr.id);
            toast.error(`${rollErr.label}: ${zoneRollError(rollErr.id)}`);
            return;
        }
        if (isPPF && (!ppfSerial.trim() || !ppfModel.trim())) {
            toast.error('Para servicios PPF ingresa serie y modelo del vehículo');
            return;
        }
        // Un corte sin rollo solo puede salir de material reutilizable
        const initialReuse = {};
        allLines.forEach(l => { initialReuse[l.key] = !l.inventory_item_id || !!l.reusable_piece_id; });
        setReuse(initialReuse);
        setStep('confirm');
    };

    // Metros que se descuentan por rollo (sin los reutilizables)
    const perRoll = {};
    allLines.forEach(l => {
        if (reuse[l.key] || !l.inventory_item_id) return;
        perRoll[l.inventory_item_id] = (perRoll[l.inventory_item_id] || 0) + (parseFloat(l.cm) || 0) / 100;
    });
    const stockProblem = Object.entries(perRoll).find(([id, m]) => (rollById(id)?.metros_restantes ?? 0) + 1e-6 < m);

    const submit = async () => {
        const zone_cuts = {};
        cutKeys.forEach(k => {
            zone_cuts[k] = (cuts[k] || []).map(l => ({
                material: l.material,
                inventory_item_id: reuse[l.key] ? (l.inventory_item_id || null) : l.inventory_item_id,
                metros: Math.round((parseFloat(l.cm) || 0)) / 100,
                reutilizable: !!reuse[l.key] || !!l.reusable_piece_id,
                reusable_piece_id: l.reusable_piece_id || null,
            }));
        });
        setSaving(true);
        try {
            const res = await cuttingAPI.complete(order.id, {
                zone_cuts,
                notes: notes.trim() || null,
                ppf_vehicle_serial: isPPF ? ppfSerial.trim() : null,
                ppf_vehicle_model: isPPF ? ppfModel.trim() : null,
            });
            const d = res.data?.inventory_deduction;
            const list = d?.multi || (d ? [d] : []);
            toast.success(list.length
                ? `Corte completado · ${list.map(x => `${x.rollo_codigo}: -${x.meters_used} m (quedan ${x.new_remaining} m)`).join(' · ')}`
                : 'Corte completado');
            const aprovs = res.data?.aprovechamientos || [];
            if (aprovs.length) toast.info(`♻ ${aprovs.length} corte(s) reutilizable(s) registrados sin descontar stock`);
            onCompleted?.();
            onClose?.();
        } catch (e) {
            const det = e.response?.data?.detail;
            toast.error(typeof det === 'string' ? det : 'No se pudo completar el corte');
        } finally {
            setSaving(false);
        }
    };

    // Referencias de corte por grupo (Black Ceramic, Ceramic i3, PPF…)
    const materialGroups = catalog?.groups?.length
        ? catalog.groups
        : catalog ? ['material_1', 'material_2', 'material_3'].filter(k => catalog[k]).map(k => catalog[k]) : [];
    const materialOptions = materialGroups.flatMap(g => g.items.map(it => ({ value: it, label: it, group: g.label })));
    // En PPF solo se ofrecen las referencias de PPF (si el catálogo las marca)
    const ppfGroups = materialGroups.filter(g => g.categoria === 'ppf');
    const ppfMaterialOptions = (ppfGroups.length ? ppfGroups : materialGroups).flatMap(g => g.items.map(it => ({ value: it, label: it, group: g.label })));
    const purchased = order.cutting_services || [];
    const rollOptions = rolls.map(r => ({ value: r.id, label: `${r.nombre} · ${fmtM(r.metros_restantes || 0)} disp. · ${r.codigo}` }));
    const ppfRefs = new Set(ppfGroups.flatMap(g => g.items));
    const ppfRollOptions = ppfRefs.size ? rollOptions.filter(o => ppfRefs.has(rollById(o.value)?.tipo_rollo)) : rollOptions;

    return (
        <Dialog open={!!order} onOpenChange={(v) => !v && !saving && onClose?.()}>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="complete-cutting-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl flex items-center gap-2">
                        <Scissors className="w-5 h-5 text-green-500" />
                        {step === 'form' ? 'Completar corte' : 'Confirmar corte'}
                    </DialogTitle>
                    <DialogDescription>{order.plate} · {order.brand} {order.model} · {order.client_name}</DialogDescription>
                </DialogHeader>

                {purchased.length > 0 && (
                    <div className="space-y-2" data-testid="cut-purchased-services">
                        {purchased.map((s, i) => {
                            const kind = serviceKind(s);
                            return (
                                <div key={i} className={`rounded-lg border px-3 py-2 ${KIND_STYLE[kind]}`}>
                                    <p className="text-[11px] uppercase tracking-wider opacity-80">
                                        {[KIND_LABEL[kind], splitService(s).category && splitService(s).category.toLowerCase() !== KIND_LABEL[kind].toLowerCase() ? splitService(s).category : null, 'servicio comprado'].filter(Boolean).join(' · ')}
                                    </p>
                                    <p className="font-heading text-2xl md:text-3xl leading-tight text-foreground">{serviceTitle(s)}</p>
                                    {kind === 'ppf' && s.ppf_scope === 'partes' && (s.ppf_parts || []).length > 0 && (
                                        <p className="text-sm mt-0.5">Partes: {s.ppf_parts.join(' · ')}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {step === 'form' ? (
                    <div className="space-y-4">
                        {/* Solo PPF: no hay vidrios que medir, se registra directo el corte PPF */}
                        {(zones.length > 0 || ppfKeys.length === 0) && (
                            <>
                                <div className="rounded-xl border overflow-hidden bg-[radial-gradient(ellipse_at_center,_#4b4f56_0%,_#2b2e33_55%,_#18191c_100%)] p-1">
                                    <Suspense fallback={<div className="h-[260px] flex items-center justify-center text-sm text-slate-300">Cargando carro 3D…</div>}>
                                        <Vehicle3D status={status} active={active} onSelect={(z) => status[z] !== 'na' && setActive(z)} className="w-full" />
                                    </Suspense>
                                </div>
                                <TechMeasurementsSummary order={order} />
                            </>
                        )}

                        {isPPF && (
                            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
                                <div className="space-y-1">
                                    <Label className="text-xs">Serie del vehículo (PPF) *</Label>
                                    <Input value={ppfSerial} onChange={(e) => setPpfSerial(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Modelo del vehículo (PPF) *</Label>
                                    <Input value={ppfModel} onChange={(e) => setPpfModel(e.target.value)} />
                                </div>
                            </div>
                        )}

                        {carAverage && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                                Promedio de material para {carAverage.brand} {carAverage.model}: <b className="text-cyan-400">{carAverage.promedio_m} m</b>
                            </p>
                        )}

                        <div className="space-y-3">
                            {zones.map(z => {
                                const ls = cuts[z.id] || [];
                                const [maxMat] = ZONE_LIMITS[z.id];
                                const err = zoneRollError(z.id);
                                return (
                                    <div
                                        key={z.id}
                                        onClick={() => setActive(z.id)}
                                        className={`p-3 rounded-lg border space-y-2 ${active === z.id ? 'border-cyan-500/60 bg-cyan-500/5' : status[z.id] === 'done' ? 'border-emerald-500/40' : 'border-amber-500/40'}`}
                                        data-testid={`cut-zone-${z.id}`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="font-medium text-sm flex items-center gap-2">
                                                <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${status[z.id] === 'done' ? 'bg-emerald-600' : 'bg-amber-500'}`}>{z.n}</span>
                                                {z.label}
                                            </p>
                                            <span className="text-xs text-muted-foreground">Técnico: <b className="text-foreground">{zoneText(tm[z.id])}</b> · {limitText(z.id)}</span>
                                        </div>
                                        {zoneOpacityText(order, z.id) && (
                                            <p className="text-xs" data-testid={`cut-opacity-${z.id}`}>
                                                <span className="px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 font-semibold">
                                                    Opacidad: {zoneOpacityText(order, z.id)}
                                                </span>
                                            </p>
                                        )}
                                        {ls.map((l, idx) => (
                                            <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1.3fr_1.3fr_1fr_auto] gap-2 items-end" data-testid={`cut-line-${z.id}-${idx}`}>
                                                <div className="space-y-1">
                                                    <Label className="text-[11px]">Material {ls.length > 1 ? idx + 1 : ''}</Label>
                                                    <TypeAheadSelect value={l.material} onChange={(v) => updateLine(z.id, l.key, {
                                                        material: v,
                                                        reusable_piece_id: '',
                                                        inventory_item_id: rollForMaterial(l, v),
                                                    })} options={materialOptions} placeholder="Seleccionar material… (escribe)"
                                                        className={selectClass} data-testid={`cut-material-${z.id}-${idx}`} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[11px]">Rollo</Label>
                                                    <TypeAheadSelect value={l.inventory_item_id} onChange={(v) => updateLine(z.id, l.key, { inventory_item_id: v, reusable_piece_id: '' })}
                                                        options={rollOptions} placeholder="Sin rollo (reutilizable)"
                                                        className={selectClass} data-testid={`cut-roll-${z.id}-${idx}`} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[11px]">Metros a cortar</Label>
                                                    <LinearMeasureInput value={l.cm} onChange={(cm) => updateLine(z.id, l.key, { cm })} testId={`cut-meters-${z.id}-${idx}`} />
                                                </div>
                                                {ls.length > 1 ? (
                                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-red-500" onClick={(e) => { e.stopPropagation(); removeLine(z.id, l.key); }} aria-label="Quitar material">
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                ) : <span />}
                                                <ReusablePiecesAlert
                                                    line={l}
                                                    options={l.material ? piecesFor(l) : []}
                                                    piece={pieceById(l.reusable_piece_id)}
                                                    onUse={(p) => updateLine(z.id, l.key, { reusable_piece_id: p.id, inventory_item_id: '' })}
                                                    onRelease={() => updateLine(z.id, l.key, {
                                                        reusable_piece_id: '',
                                                        inventory_item_id: rolls.find(r => r.tipo_rollo === l.material)?.id || '',
                                                    })}
                                                    testId={`cut-reusable-${z.id}-${idx}`}
                                                />
                                            </div>
                                        ))}
                                        {err && <p className="text-xs text-red-500">{err}</p>}
                                        {ls.length < maxMat && (
                                            <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); addLine(z.id); }} data-testid={`cut-add-${z.id}`}>
                                                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar material ({ls.length}/{maxMat})
                                            </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {ppfKeys.length > 0 && (
                            <div className="p-3 rounded-lg border border-purple-500/40 bg-purple-500/5 space-y-3" data-testid="cut-ppf-section">
                                <div>
                                    <p className="font-medium text-sm text-purple-300">
                                        {ppfPlan.scope === 'full' ? 'PPF Full · un corte aproximado para todo el carro' : `PPF por partes · corte lineal de cada parte (${ppfKeys.length})`}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {ppfPlan.scope === 'full'
                                            ? 'Registra el material, el rollo y los metros aproximados que se usaron en todo el vehículo.'
                                            : 'Registra el material, el rollo y los metros lineales de cada parte que compró el cliente.'}
                                    </p>
                                </div>
                                {ppfKeys.map(k => (cuts[k] || []).map(l => (
                                    <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_1.3fr_1.3fr_1fr] gap-2 items-end" data-testid={`cut-line-${k}`}>
                                        <p className="text-sm font-medium sm:pb-2">{ppfLabel(k)}</p>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">Material PPF</Label>
                                            <TypeAheadSelect value={l.material} onChange={(v) => updateLine(k, l.key, {
                                                material: v, reusable_piece_id: '',
                                                inventory_item_id: rollForMaterial(l, v),
                                            })} options={ppfMaterialOptions} placeholder="Seleccionar PPF… (escribe)"
                                                className={selectClass} data-testid={`cut-material-${k}`} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">Rollo</Label>
                                            <TypeAheadSelect value={l.inventory_item_id} onChange={(v) => updateLine(k, l.key, { inventory_item_id: v, reusable_piece_id: '' })}
                                                options={ppfRollOptions} placeholder="Sin rollo (reutilizable)"
                                                className={selectClass} data-testid={`cut-roll-${k}`} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">{k === PPF_FULL ? 'Metros aprox.' : 'Corte lineal'}</Label>
                                            <LinearMeasureInput value={l.cm} onChange={(cm) => updateLine(k, l.key, { cm })} testId={`cut-meters-${k}`} />
                                        </div>
                                        <ReusablePiecesAlert
                                            line={l}
                                            options={l.material ? piecesFor(l) : []}
                                            piece={pieceById(l.reusable_piece_id)}
                                            onUse={(p) => updateLine(k, l.key, { reusable_piece_id: p.id, inventory_item_id: '' })}
                                            onRelease={() => updateLine(k, l.key, { reusable_piece_id: '', inventory_item_id: rolls.find(r => r.tipo_rollo === l.material)?.id || '' })}
                                            testId={`cut-reusable-${k}`}
                                        />
                                    </div>
                                )))}
                            </div>
                        )}

                        <div className="space-y-1">
                            <Label>Observaciones del corte</Label>
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={onClose}>Cancelar</Button>
                            <Button className="sm:flex-1 bg-green-600 hover:bg-green-700" onClick={goConfirm} data-testid="cut-review">
                                <CheckCircle2 className="w-4 h-4 mr-2" /> Revisar y confirmar corte
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4" data-testid="cut-confirm-step">
                        <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-sm flex gap-2">
                            <Recycle className="w-5 h-5 text-emerald-400 shrink-0" />
                            <div>
                                <p className="font-medium">¿Usaste material reutilizable?</p>
                                <p className="text-muted-foreground text-xs">Marca los cortes que salieron de reutilizables: no se descuentan del rollo y quedan registrados como aprovechamiento.</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {allLines.map(l => {
                                const roll = rollById(l.inventory_item_id);
                                return (
                                    <label key={l.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${reuse[l.key] ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border'}`} data-testid={`cut-confirm-line-${l.zone}`}>
                                        <input
                                            type="checkbox"
                                            checked={!!reuse[l.key]}
                                            disabled={!l.inventory_item_id || !!l.reusable_piece_id}
                                            onChange={(e) => setReuse(prev => ({ ...prev, [l.key]: e.target.checked }))}
                                            className="w-4 h-4 accent-emerald-500"
                                            data-testid={`cut-reuse-${l.key}`}
                                        />
                                        <div className="flex-1 min-w-0 text-sm">
                                            <p className="font-medium">{lineTitle(l.zone)} · {formatLinear(parseFloat(l.cm))}{zoneOpacityText(order, l.zone) ? ` · ${zoneOpacityText(order, l.zone)}` : ''}</p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {l.material} · {l.reusable_piece_id ? `pieza reutilizable ${pieceById(l.reusable_piece_id)?.codigo || ''}` : roll ? `${roll.codigo} ${roll.nombre}` : 'sin rollo'}
                                            </p>
                                        </div>
                                        <span className={`text-xs whitespace-nowrap ${reuse[l.key] ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                                            {reuse[l.key] ? 'Reutilizable' : 'Descuenta del rollo'}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="rounded-lg border p-3 text-sm space-y-1" data-testid="cut-roll-totals">
                            <p className="font-medium">Se descontará del inventario</p>
                            {Object.keys(perRoll).length === 0 ? (
                                <p className="text-xs text-muted-foreground">Nada: todos los cortes son reutilizables.</p>
                            ) : Object.entries(perRoll).map(([id, m]) => {
                                const r = rollById(id);
                                const left = (r?.metros_restantes ?? 0) - m;
                                return (
                                    <p key={id} className={`text-xs flex justify-between gap-2 ${left < 0 ? 'text-red-500' : ''}`}>
                                        <span>{r?.codigo} · {r?.nombre}</span>
                                        <span className="font-mono">-{fmtM(m)} · quedan {fmtM(Math.max(left, 0))}</span>
                                    </p>
                                );
                            })}
                            {stockProblem && (
                                <p className="text-xs text-red-500 flex items-center gap-1 pt-1">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Un rollo no tiene metros suficientes. Cambia el rollo o marca el corte como reutilizable.
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setStep('form')} disabled={saving}>
                                <ArrowLeft className="w-4 h-4 mr-2" /> Volver
                            </Button>
                            <Button className="sm:flex-1 bg-green-600 hover:bg-green-700" onClick={submit} disabled={saving || !!stockProblem} data-testid="cut-confirm">
                                <Scissors className="w-4 h-4 mr-2" />
                                {saving ? 'Guardando...' : 'Confirmar corte'}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default CompleteCuttingDialog;
