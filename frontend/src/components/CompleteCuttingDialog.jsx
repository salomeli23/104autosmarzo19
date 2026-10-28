import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { MEASURE_ZONES } from '../lib/measureZones';
import { LinearMeasureInput, formatLinear } from './LinearMeasureInput';
import { TechMeasurementsSummary, zoneText } from './TechMeasurements';
import { zoneOpacityText } from '../lib/opacity';
import { cuttingAPI, inventoryAPI, cuttingCatalogAPI } from '../lib/api';
import { toast } from 'sonner';
import { Scissors, Plus, Trash2, Recycle, CheckCircle2, ArrowLeft, Gauge, AlertTriangle } from 'lucide-react';

const Vehicle3D = React.lazy(() => import('./Vehicle3D'));

// (máx. materiales, máx. rollos) por zona — igual que ZONE_CUT_LIMITS en el backend
const ZONE_LIMITS = {
    panoramico: [1, 1],
    trasero: [1, 1],
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
const newLine = (cm = '') => ({ key: `l${lineKey++}`, material: '', inventory_item_id: '', cm });

const orderHasPPF = (order) => (order?.cutting_services || order?.services || []).some(s => {
    const txt = `${s.name || ''} ${s.description || ''} ${s.service || ''}`.toLowerCase();
    return txt.includes('ppf') || txt.includes('proteccion') || txt.includes('protección');
});

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
    const [catalog, setCatalog] = useState(null);
    const [carAverage, setCarAverage] = useState(null);
    const [saving, setSaving] = useState(false);

    const tm = useMemo(() => order?.tech_measurements || {}, [order]);
    const zones = useMemo(() => MEASURE_ZONES.filter(z => tm[z.id] && tm[z.id].aplica !== false), [tm]);

    useEffect(() => {
        if (!order) return;
        const init = {};
        MEASURE_ZONES.forEach(z => {
            const t = tm[z.id];
            if (t && t.aplica !== false) init[z.id] = [newLine(t.medida_cm || '')];
        });
        setCuts(init);
        setActive(Object.keys(init)[0] || null);
        setStep('form');
        setReuse({});
        setNotes('');
        setPpfSerial(order.ppf_vehicle_serial || '');
        setPpfModel(order.ppf_vehicle_model || '');
        inventoryAPI.list({ tipo_articulo: 'rollo' })
            .then(res => setRolls((res.data || []).filter(r => (r.metros_restantes ?? 0) > 0)))
            .catch(() => setRolls([]));
        if (!catalog) cuttingCatalogAPI.getMaterials().then(res => setCatalog(res.data)).catch(() => {});
        cuttingCatalogAPI.getCarAverage(order.brand || '', order.model || '')
            .then(res => setCarAverage(res.data?.found ? res.data : null))
            .catch(() => setCarAverage(null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    if (!order) return null;

    const isPPF = orderHasPPF(order);
    const rollById = (id) => rolls.find(r => r.id === id);
    const allLines = zones.flatMap(z => (cuts[z.id] || []).map(l => ({ ...l, zone: z.id })));

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
        const [, maxRolls] = ZONE_LIMITS[zone];
        const used = new Set((cuts[zone] || []).map(l => l.inventory_item_id).filter(Boolean));
        return used.size > maxRolls ? `Máximo ${maxRolls} rollo(s) en esta zona` : null;
    };

    const goConfirm = () => {
        if (allLines.length === 0) {
            toast.error('No hay zonas con medidas del técnico para cortar');
            return;
        }
        const missing = allLines.find(l => !l.material || !(parseFloat(l.cm) > 0));
        if (missing) {
            setActive(missing.zone);
            toast.error(`Completa material y metros en ${MEASURE_ZONES.find(z => z.id === missing.zone).label}`);
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
        allLines.forEach(l => { initialReuse[l.key] = !l.inventory_item_id; });
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
        zones.forEach(z => {
            zone_cuts[z.id] = (cuts[z.id] || []).map(l => ({
                material: l.material,
                inventory_item_id: reuse[l.key] ? (l.inventory_item_id || null) : l.inventory_item_id,
                metros: Math.round((parseFloat(l.cm) || 0)) / 100,
                reutilizable: !!reuse[l.key],
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

    const materialGroups = catalog ? ['material_1', 'material_2', 'material_3'].filter(k => catalog[k]).map(k => catalog[k]) : [];

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

                {step === 'form' ? (
                    <div className="space-y-4">
                        <div className="rounded-xl border overflow-hidden bg-[radial-gradient(ellipse_at_center,_#4b4f56_0%,_#2b2e33_55%,_#18191c_100%)] p-1">
                            <Suspense fallback={<div className="h-[260px] flex items-center justify-center text-sm text-slate-300">Cargando carro 3D…</div>}>
                                <Vehicle3D status={status} active={active} onSelect={(z) => status[z] !== 'na' && setActive(z)} className="w-full" />
                            </Suspense>
                        </div>
                        <TechMeasurementsSummary order={order} />

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
                                                    <select value={l.material} onChange={(e) => updateLine(z.id, l.key, { material: e.target.value })} className={selectClass} data-testid={`cut-material-${z.id}-${idx}`}>
                                                        <option value="">Seleccionar material…</option>
                                                        {materialGroups.map(g => (
                                                            <optgroup key={g.label} label={g.label}>
                                                                {g.items.map(it => <option key={it} value={it}>{it}</option>)}
                                                            </optgroup>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[11px]">Rollo</Label>
                                                    <select value={l.inventory_item_id} onChange={(e) => updateLine(z.id, l.key, { inventory_item_id: e.target.value })} className={selectClass} data-testid={`cut-roll-${z.id}-${idx}`}>
                                                        <option value="">Sin rollo (reutilizable)</option>
                                                        {rolls.map(r => (
                                                            <option key={r.id} value={r.id}>{r.codigo} · {r.nombre} · {fmtM(r.metros_restantes || 0)} disp.</option>
                                                        ))}
                                                    </select>
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
                                const z = MEASURE_ZONES.find(x => x.id === l.zone);
                                const roll = rollById(l.inventory_item_id);
                                return (
                                    <label key={l.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${reuse[l.key] ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border'}`} data-testid={`cut-confirm-line-${l.zone}`}>
                                        <input
                                            type="checkbox"
                                            checked={!!reuse[l.key]}
                                            disabled={!l.inventory_item_id}
                                            onChange={(e) => setReuse(prev => ({ ...prev, [l.key]: e.target.checked }))}
                                            className="w-4 h-4 accent-emerald-500"
                                            data-testid={`cut-reuse-${l.key}`}
                                        />
                                        <div className="flex-1 min-w-0 text-sm">
                                            <p className="font-medium">{z.n}. {z.label} · {formatLinear(parseFloat(l.cm))}{zoneOpacityText(order, l.zone) ? ` · ${zoneOpacityText(order, l.zone)}` : ''}</p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {l.material} · {roll ? `${roll.codigo} ${roll.nombre}` : 'sin rollo'}
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
