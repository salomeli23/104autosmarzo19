import React, { Suspense, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { MEASURE_ZONES } from '../lib/measureZones';
import { LinearMeasureInput, formatLinear } from './LinearMeasureInput';
import { zoneOpacityText } from '../lib/opacity';

// three.js solo se descarga cuando se abre la ventana de medidas
const Vehicle3D = React.lazy(() => import('./Vehicle3D'));
import { ordersAPI } from '../lib/api';
import { toast } from 'sonner';
import { Ruler, CheckCircle2, Clock } from 'lucide-react';

const LEFT_PARTS = ['vidrio_piloto', 'vidrio_trasero_piloto', 'custodias'];
const RIGHT_PARTS = ['vidrio_copiloto', 'vidrio_trasero_copiloto', 'custodias'];
const REAR_PARTS = ['luneta', 'trasero', 'vidrio_trasero'];

// Qué zonas aplican según los servicios de la orden (si no hay partes, todas menos sunroof)
const defaultApplies = (order) => {
    const services = (order?.services || []).filter(s => s && typeof s === 'object');
    const parts = new Set(services.flatMap(s => s.parts || []));
    const hasSunroof = parts.has('sunroof') || services.some(s => String(s.service || '').includes('sunroof'));
    if (parts.size === 0 || (parts.size === 1 && hasSunroof)) {
        return { panoramico: true, trasero: true, laterales_izquierdo: true, laterales_derecho: true, sunroof: hasSunroof };
    }
    return {
        panoramico: parts.has('panoramico'),
        trasero: REAR_PARTS.some(p => parts.has(p)),
        laterales_izquierdo: LEFT_PARTS.some(p => parts.has(p)),
        laterales_derecho: RIGHT_PARTS.some(p => parts.has(p)),
        sunroof: hasSunroof,
    };
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
            <div className={compact ? 'flex flex-wrap gap-x-3 gap-y-0.5' : 'grid grid-cols-2 gap-x-3 gap-y-0.5'}>
                {MEASURE_ZONES.filter(z => m[z.id]).map(z => (
                    <span key={z.id} className={m[z.id]?.aplica === false ? 'text-muted-foreground' : ''}>
                        <b>{z.n}. {z.label}:</b> {zoneText(m[z.id])}
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

/**
 * Ventana donde el técnico coloca y confirma las medidas por zona.
 * Props: order (null para cerrar), onClose(), onSaved()
 */
export const TechMeasurementsDialog = ({ order, onClose, onSaved }) => {
    const [zones, setZones] = useState({});
    const [notes, setNotes] = useState('');
    const [active, setActive] = useState('panoramico');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!order) return;
        const prev = order.tech_measurements;
        const applies = defaultApplies(order);
        const next = {};
        MEASURE_ZONES.forEach(z => {
            const p = prev?.[z.id];
            next[z.id] = p
                ? { aplica: p.aplica !== false, medida_cm: p.medida_cm ?? '', piezas: p.piezas ?? '' }
                : emptyZone(applies[z.id]);
            if (z.id.startsWith('laterales') && !next[z.id].piezas) next[z.id].piezas = '2';
        });
        setZones(next);
        setNotes(prev?.notes || '');
        setActive(MEASURE_ZONES.find(z => next[z.id].aplica)?.id || 'panoramico');
    }, [order]);

    if (!order) return null;

    const zoneState = (id) => {
        const z = zones[id];
        if (!z) return 'pending';
        if (!z.aplica) return 'na';
        return parseFloat(z.medida_cm) > 0 ? 'done' : 'pending';
    };
    const status = Object.fromEntries(MEASURE_ZONES.map(z => [z.id, zoneState(z.id)]));
    const update = (id, changes) => setZones(prev => ({ ...prev, [id]: { ...prev[id], ...changes } }));

    const save = async () => {
        const missing = MEASURE_ZONES.filter(z => status[z.id] === 'pending');
        if (missing.length) {
            setActive(missing[0].id);
            toast.error(`Coloca la medida de ${missing.map(z => z.label).join(', ')} o márcalo como No aplica`);
            return;
        }
        if (MEASURE_ZONES.every(z => status[z.id] === 'na')) {
            toast.error('Coloca las medidas de al menos una zona');
            return;
        }
        const payload = { notes: notes.trim() || null };
        MEASURE_ZONES.forEach(z => {
            const v = zones[z.id];
            payload[z.id] = v.aplica
                ? { aplica: true, medida_cm: parseFloat(v.medida_cm), piezas: z.id.startsWith('laterales') ? parseInt(v.piezas, 10) || 1 : null }
                : { aplica: false };
        });
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
                        {order.plate} · {order.brand} {order.model}. Indica cuánto material necesitas por zona; Corte no puede completar el corte sin estas medidas.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-xl border overflow-hidden bg-[radial-gradient(ellipse_at_center,_#4b4f56_0%,_#2b2e33_55%,_#18191c_100%)] p-1">
                    <Suspense fallback={<div className="h-[300px] flex items-center justify-center text-sm text-slate-300">Cargando carro 3D…</div>}>
                        <Vehicle3D status={status} active={active} onSelect={setActive} className="w-full" />
                    </Suspense>
                    <div className="flex flex-wrap justify-center gap-3 text-[11px] text-slate-300 pb-1">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Falta medida</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Medida lista</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> No aplica</span>
                    </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    {MEASURE_ZONES.map(z => {
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
