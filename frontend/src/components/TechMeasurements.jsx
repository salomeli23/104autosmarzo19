import React, { Suspense, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
    MEASURE_ZONES, LEGACY_MEASURE_ZONES, MODEL_MEASURE_ZONES, CUT_MODELS, WINDOWS,
    windowLabel, cutModelLabel, zonesInMeasurements,
} from '../lib/measureZones';
import { LinearMeasureInput, formatLinear } from './LinearMeasureInput';
import { zoneOpacityText } from '../lib/opacity';
import { ordersAPI } from '../lib/api';
import { toast } from 'sonner';
import { Ruler, CheckCircle2, Clock, Plus, Trash2 } from 'lucide-react';

// three.js solo se descarga cuando se abre la ventana de medidas
const Vehicle3D = React.lazy(() => import('./Vehicle3D'));

const FRONT_SIDE_PARTS = ['vidrio_piloto', 'vidrio_copiloto'];
const REAR_SIDE_PARTS = ['vidrio_trasero_piloto', 'vidrio_trasero_copiloto', 'custodias'];
const REAR_PARTS = ['luneta', 'trasero', 'vidrio_trasero'];
// Ventanas del carro 3D de cada zona (igual que STANDARD_ZONE_WINDOWS en Vehicle3D; aquí para no cargar three.js antes)
const ZONE_WINDOWS = {
    panoramico: ['panoramico'],
    trasero: ['luneta'],
    laterales_delanteros: ['delantera_der', 'delantera_izq'],
    laterales_traseros: ['trasera_der', 'custodia_der', 'trasera_izq', 'custodia_izq'],
    laterales_derecho: ['delantera_der', 'trasera_der', 'custodia_der'],
    laterales_izquierdo: ['delantera_izq', 'trasera_izq', 'custodia_izq'],
    sunroof: ['sunroof'],
};
const MODEL_HINTS = {
    estandar: 'Arrastra para girar · toca un vidrio para ir a su zona',
    lados: 'Corte A = lado derecho · Corte B = lado izquierdo',
    ventanas: 'Toca un corte y luego las ventanas que lleva (máx. 2)',
};
const ALL_ZONES = [...MEASURE_ZONES, ...LEGACY_MEASURE_ZONES];

// Qué zonas aplican según los servicios de la orden (si no hay partes, todas menos sunroof)
const defaultApplies = (order) => {
    const services = (order?.services || []).filter(s => s && typeof s === 'object');
    const parts = new Set(services.flatMap(s => s.parts || []));
    const hasSunroof = parts.has('sunroof') || services.some(s => String(s.service || '').includes('sunroof'));
    const base = (parts.size === 0 || (parts.size === 1 && hasSunroof))
        ? { panoramico: true, trasero: true, laterales_delanteros: true, laterales_traseros: true, sunroof: hasSunroof }
        : {
            panoramico: parts.has('panoramico'),
            trasero: REAR_PARTS.some(p => parts.has(p)),
            laterales_delanteros: FRONT_SIDE_PARTS.some(p => parts.has(p)),
            laterales_traseros: REAR_SIDE_PARTS.some(p => parts.has(p)),
            sunroof: hasSunroof,
        };
    const sides = base.laterales_delanteros || base.laterales_traseros;
    return { ...base, laterales_derecho: sides, laterales_izquierdo: sides };
};

export const zoneText = (z) => {
    if (z?.aplica === false) return 'No aplica';
    // Medidas antiguas en ancho × alto
    const base = z?.medida_cm ? formatLinear(z.medida_cm) : `${z?.ancho ?? '?'} × ${z?.alto ?? '?'} cm`;
    return `${base}${z?.piezas ? ` · ${z.piezas} vidrios` : ''}`;
};

/** Resumen de las medidas del técnico (Corte, Mis Servicios). */
export const TechMeasurementsSummary = ({ order, compact = false }) => {
    const m = order?.tech_measurements;
    if (!m?.confirmed_at) {
        return (
            <p className="text-xs text-amber-500 flex items-center gap-1" data-testid={`measurements-pending-${order?.id}`}>
                <Clock className="w-3.5 h-3.5" /> Esperando medidas del técnico
            </p>
        );
    }
    return (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs space-y-1" data-testid={`measurements-summary-${order.id}`}>
            <p className="text-emerald-400 font-medium flex items-center gap-1">
                <Ruler className="w-3.5 h-3.5" /> Medidas del técnico · {m.confirmed_by_name}
            </p>
            {m.cut_model && m.cut_model !== 'estandar' && (
                <p className="text-cyan-400" data-testid={`measurements-model-${order.id}`}>{cutModelLabel(m.cut_model)}</p>
            )}
            <div className={compact ? 'flex flex-wrap gap-x-3 gap-y-0.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5'}>
                {zonesInMeasurements(m).filter(z => m[z.id]).map(z => (
                    <span key={z.id} className={m[z.id]?.aplica === false ? 'text-muted-foreground' : ''}>
                        <b>{typeof z.n === 'number' ? `${z.n}. ` : ''}{z.label}:</b> {zoneText(m[z.id])}
                    </span>
                ))}
                {(m.ventanas || []).map((c, i) => (
                    <span key={`v${i}`}>
                        <b>Corte {i + 1} · {c.windows.map(windowLabel).join(' + ')}:</b> {formatLinear(c.medida_cm)}
                    </span>
                ))}
                {m.laterales && (
                    <span className={m.laterales.aplica === false ? 'text-muted-foreground' : ''}>
                        <b>Laterales:</b> {zoneText(m.laterales)}
                    </span>
                )}
            </div>
            {m.notes && <p className="italic text-muted-foreground">“{m.notes}”</p>}
        </div>
    );
};

const emptyZone = (applies) => ({ aplica: applies, medida_cm: '', piezas: '' });
let cutSeq = 1;
const newCut = (windows = [], medida = '') => ({ key: `c${cutSeq++}`, windows, medida_cm: medida });

/** Selector de los 3 modelos de corte */
const ModelPicker = ({ value, onChange }) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="measure-model-picker">
        {CUT_MODELS.map(m => (
            <button key={m.id} type="button" onClick={() => onChange(m.id)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${value === m.id ? 'border-cyan-500/70 bg-cyan-500/10' : 'border-border hover:border-cyan-500/40'}`}
                data-testid={`measure-model-${m.id}`}>
                <p className={`text-sm font-semibold ${value === m.id ? 'text-cyan-300' : ''}`}>{m.label}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">{m.hint}</p>
            </button>
        ))}
    </div>
);

/**
 * Ventana donde el técnico elige el modelo de corte y coloca y confirma las medidas.
 * Props: order (null para cerrar), onClose(), onSaved()
 */
export const TechMeasurementsDialog = ({ order, onClose, onSaved }) => {
    const [model, setModel] = useState('estandar');
    const [zones, setZones] = useState({});
    const [cuts, setCuts] = useState([]); // modelo 3: [{key, windows, medida_cm}]
    const [notes, setNotes] = useState('');
    const [active, setActive] = useState('panoramico');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!order) return;
        const prev = order.tech_measurements;
        const applies = defaultApplies(order);
        const next = {};
        ALL_ZONES.forEach(z => {
            const p = prev?.[z.id];
            next[z.id] = p
                ? { aplica: p.aplica !== false, medida_cm: p.medida_cm ?? '', piezas: p.piezas ?? '' }
                : emptyZone(applies[z.id]);
            if (z.id.startsWith('laterales') && !next[z.id].piezas) next[z.id].piezas = '2';
        });
        const prevModel = prev?.cut_model || 'estandar';
        const prevCuts = (prev?.ventanas || []).map(c => newCut(c.windows || [], c.medida_cm ?? ''));
        setModel(prevModel);
        setZones(next);
        setCuts(prevCuts.length ? prevCuts : [newCut()]);
        setNotes(prev?.notes || '');
        setActive(prevModel === 'ventanas'
            ? (prevCuts[0]?.key || null)
            : (MODEL_MEASURE_ZONES[prevModel] || MEASURE_ZONES).find(z => next[z.id].aplica)?.id || 'panoramico');
    }, [order]);

    if (!order) return null;

    const modelZones = MODEL_MEASURE_ZONES[model] || [];
    const zoneState = (id) => {
        const z = zones[id];
        if (!z) return 'pending';
        if (!z.aplica) return 'na';
        return parseFloat(z.medida_cm) > 0 ? 'done' : 'pending';
    };
    const cutState = (c) => (c.windows.length && parseFloat(c.medida_cm) > 0 ? 'done' : 'pending');
    const status = model === 'ventanas'
        ? Object.fromEntries(cuts.map(c => [c.key, cutState(c)]))
        : Object.fromEntries(modelZones.map(z => [z.id, zoneState(z.id)]));
    const zones3d = model === 'ventanas'
        ? cuts.map((c, i) => ({ id: c.key, n: i + 1, windows: c.windows }))
        : modelZones.map(z => ({ id: z.id, n: z.n, windows: ZONE_WINDOWS[z.id] }));
    const update = (id, changes) => setZones(prev => ({ ...prev, [id]: { ...prev[id], ...changes } }));

    // Modelo 3: cortes de 1 o 2 ventanas
    const windowOwner = (w) => cuts.find(c => c.windows.includes(w));
    const updateCut = (key, changes) => setCuts(prev => prev.map(c => (c.key === key ? { ...c, ...changes } : c)));
    const toggleWindow = (key, w) => {
        const cut = cuts.find(c => c.key === key);
        if (!cut) return;
        if (cut.windows.includes(w)) { updateCut(key, { windows: cut.windows.filter(x => x !== w) }); return; }
        const owner = windowOwner(w);
        if (owner) { toast.error(`${windowLabel(w)} ya está en otro corte`); return; }
        if (cut.windows.length >= 2) { toast.error('Máximo 2 ventanas por corte'); return; }
        updateCut(key, { windows: [...cut.windows, w] });
    };
    const addCut = () => {
        const c = newCut();
        setCuts(prev => [...prev, c]);
        setActive(c.key);
    };
    const removeCut = (key) => {
        setCuts(prev => prev.filter(c => c.key !== key));
        if (active === key) setActive(null);
    };
    const select3dWindow = (w) => {
        if (model !== 'ventanas') return;
        if (!cuts.some(c => c.key === active)) { toast.info('Primero toca el corte al que quieres sumar la ventana'); return; }
        toggleWindow(active, w);
    };
    const changeModel = (m) => {
        if (m === model) return;
        setModel(m);
        if (m === 'ventanas') {
            const list = cuts.length ? cuts : [newCut()];
            if (!cuts.length) setCuts(list);
            setActive(list[0].key);
        } else {
            setActive(MODEL_MEASURE_ZONES[m].find(z => zones[z.id]?.aplica)?.id || 'panoramico');
        }
    };

    const save = async () => {
        const payload = { cut_model: model, notes: notes.trim() || null };
        if (model === 'ventanas') {
            if (!cuts.length) { toast.error('Agrega al menos un corte'); return; }
            const bad = cuts.findIndex(c => cutState(c) === 'pending');
            if (bad >= 0) {
                setActive(cuts[bad].key);
                toast.error(`Corte ${bad + 1}: elige sus ventanas (1 o 2) y coloca la medida`);
                return;
            }
            payload.ventanas = cuts.map(c => ({ windows: c.windows, medida_cm: parseFloat(c.medida_cm) }));
        } else {
            const missing = modelZones.filter(z => status[z.id] === 'pending');
            if (missing.length) {
                setActive(missing[0].id);
                toast.error(`Coloca la medida de ${missing.map(z => z.label).join(', ')} o márcalo como No aplica`);
                return;
            }
            if (modelZones.every(z => status[z.id] === 'na')) {
                toast.error('Coloca las medidas de al menos una zona');
                return;
            }
            modelZones.forEach(z => {
                const v = zones[z.id];
                payload[z.id] = v.aplica
                    ? { aplica: true, medida_cm: parseFloat(v.medida_cm), piezas: z.id.startsWith('laterales') ? parseInt(v.piezas, 10) || 1 : null }
                    : { aplica: false };
            });
        }
        setSaving(true);
        try {
            await ordersAPI.saveTechMeasurements(order.id, payload);
            toast.success('Medidas confirmadas · Corte fue notificado');
            onSaved?.();
            onClose?.();
        } catch (e) {
            const d = e.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'No se pudieron guardar las medidas');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!order} onOpenChange={(v) => !v && !saving && onClose?.()}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="tech-measurements-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl flex items-center gap-2">
                        <Ruler className="w-5 h-5 text-primary" />
                        Colocar medidas
                    </DialogTitle>
                    <DialogDescription>
                        {order.plate} · {order.brand} {order.model}. Elige el modelo de corte e indica cuánto material necesitas; Corte no puede completar el corte sin estas medidas.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-1">
                    <Label>Modelo de corte</Label>
                    <ModelPicker value={model} onChange={changeModel} />
                </div>

                <div className="rounded-xl border overflow-hidden bg-[radial-gradient(ellipse_at_center,_#4b4f56_0%,_#2b2e33_55%,_#18191c_100%)] p-1">
                    <Suspense fallback={<div className="h-[300px] flex items-center justify-center text-sm text-slate-300">Cargando carro 3D…</div>}>
                        <Vehicle3D zones={zones3d} status={status} active={active} onSelect={setActive}
                            onSelectWindow={select3dWindow} hint={MODEL_HINTS[model]} className="w-full" />
                    </Suspense>
                    <div className="flex flex-wrap justify-center gap-3 text-[11px] text-slate-300 pb-1">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Falta medida</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Medida lista</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> No aplica</span>
                    </div>
                </div>

                {model === 'ventanas' ? (
                    <div className="space-y-3" data-testid="measure-window-cuts">
                        {cuts.map((c, i) => {
                            const st = cutState(c);
                            return (
                                <div key={c.key} onClick={() => setActive(c.key)}
                                    className={`p-3 rounded-lg border space-y-2 transition-colors ${active === c.key ? 'border-cyan-500/60 bg-cyan-500/5' : st === 'done' ? 'border-emerald-500/40' : 'border-amber-500/40'}`}
                                    data-testid={`measure-cut-${i}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-medium text-sm flex items-center gap-2">
                                            <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${st === 'done' ? 'bg-emerald-600' : 'bg-amber-500'}`}>{i + 1}</span>
                                            Corte {i + 1}
                                            {c.windows.length > 0 && <span className="text-xs text-muted-foreground font-normal">· {c.windows.map(windowLabel).join(' + ')}</span>}
                                        </p>
                                        {cuts.length > 1 && (
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                                                onClick={(e) => { e.stopPropagation(); removeCut(c.key); }} aria-label="Quitar corte">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {WINDOWS.map(w => {
                                            const on = c.windows.includes(w.id);
                                            const taken = !on && windowOwner(w.id);
                                            return (
                                                <button key={w.id} type="button" disabled={!!taken}
                                                    onClick={(e) => { e.stopPropagation(); setActive(c.key); toggleWindow(c.key, w.id); }}
                                                    className={`px-2 py-1 rounded-full border text-xs transition-colors ${on ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300' : taken ? 'opacity-35 line-through' : 'hover:border-cyan-500/50'}`}
                                                    data-testid={`measure-cut-${i}-win-${w.id}`}>
                                                    {w.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-[11px]">Medida lineal (m / cm)</Label>
                                        <LinearMeasureInput value={c.medida_cm} onChange={(cm) => updateCut(c.key, { medida_cm: cm })} testId={`measure-cut-lineal-${i}`} />
                                    </div>
                                </div>
                            );
                        })}
                        <Button type="button" variant="outline" size="sm" onClick={addCut} disabled={cuts.length >= WINDOWS.length} data-testid="measure-add-cut">
                            <Plus className="w-4 h-4 mr-1" /> Agregar corte
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {modelZones.map(z => {
                            const v = zones[z.id] || emptyZone(true);
                            const st = status[z.id];
                            return (
                                <div
                                    key={z.id}
                                    onClick={() => setActive(z.id)}
                                    className={`p-3 rounded-lg border space-y-2 transition-colors ${active === z.id ? 'border-cyan-500/60 bg-cyan-500/5' : st === 'done' ? 'border-emerald-500/40' : st === 'na' ? 'border-border opacity-70' : 'border-amber-500/40'}`}
                                    data-testid={`measure-zone-${z.id}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-medium text-sm flex items-center gap-2">
                                            <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${st === 'done' ? 'bg-emerald-600' : st === 'na' ? 'bg-slate-500' : 'bg-amber-500'}`}>{z.n}</span>
                                            {z.label}
                                        </p>
                                        <label className="flex items-center gap-1 text-xs cursor-pointer text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                checked={!v.aplica}
                                                onChange={(e) => update(z.id, { aplica: !e.target.checked })}
                                                className="w-3.5 h-3.5"
                                                data-testid={`measure-na-${z.id}`}
                                            />
                                            No aplica
                                        </label>
                                    </div>
                                    {z.hint && <p className="text-[11px] text-cyan-400">{z.hint}</p>}
                                    {zoneOpacityText(order, z.id) && (
                                        <p className="text-[11px]" data-testid={`measure-opacity-${z.id}`}>
                                            <span className="px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 font-semibold">
                                                Opacidad: {zoneOpacityText(order, z.id)}
                                            </span>
                                        </p>
                                    )}
                                    {v.aplica && (
                                        <div className={`grid gap-2 ${z.id.startsWith('laterales') ? 'grid-cols-[1fr_72px]' : 'grid-cols-1'}`}>
                                            <div className="space-y-1">
                                                <Label className="text-[11px]">Medida lineal (m / cm)</Label>
                                                <LinearMeasureInput
                                                    value={v.medida_cm}
                                                    onChange={(cm) => update(z.id, { medida_cm: cm })}
                                                    testId={`measure-lineal-${z.id}`}
                                                />
                                            </div>
                                            {z.id.startsWith('laterales') && (
                                                <div className="space-y-1">
                                                    <Label className="text-[11px]">Vidrios</Label>
                                                    <Input type="number" min="1" max="10" inputMode="numeric" value={v.piezas} onChange={(e) => update(z.id, { piezas: e.target.value })} className="h-9" data-testid={`measure-piezas-${z.id}`} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="space-y-1">
                    <Label>Observaciones para Corte</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <Button variant="outline" className="sm:flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
                    <Button className="sm:flex-1 brand-glow" onClick={save} disabled={saving} data-testid="tech-measurements-save">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {saving ? 'Enviando...' : 'Confirmar medidas'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default TechMeasurementsDialog;
