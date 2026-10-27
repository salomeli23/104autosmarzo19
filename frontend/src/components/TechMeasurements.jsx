import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { VehicleGlassDiagram, MEASURE_ZONES } from './VehicleGlassDiagram';
import { ordersAPI } from '../lib/api';
import { toast } from 'sonner';
import { Ruler, CheckCircle2, Clock } from 'lucide-react';

const LATERAL_PARTS = ['vidrio_copiloto', 'vidrio_piloto', 'vidrio_trasero_piloto', 'vidrio_trasero_copiloto', 'custodias'];
const REAR_PARTS = ['luneta', 'trasero', 'vidrio_trasero'];

// Qué zonas aplican según los servicios de la orden (si no hay partes, todas menos sunroof)
const defaultApplies = (order) => {
    const services = (order?.services || []).filter(s => s && typeof s === 'object');
    const parts = new Set(services.flatMap(s => s.parts || []));
    const hasSunroof = parts.has('sunroof') || services.some(s => String(s.service || '').includes('sunroof'));
    if (parts.size === 0 || (parts.size === 1 && hasSunroof)) {
        return { panoramico: true, trasero: true, laterales: true, sunroof: hasSunroof };
    }
    return {
        panoramico: parts.has('panoramico'),
        trasero: REAR_PARTS.some(p => parts.has(p)),
        laterales: LATERAL_PARTS.some(p => parts.has(p)),
        sunroof: hasSunroof,
    };
};

export const zoneText = (z) => (z?.aplica === false ? 'No aplica'
    : `${z?.ancho ?? '?'} × ${z?.alto ?? '?'} cm${z?.piezas ? ` · ${z.piezas} vidrios` : ''}`);

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
                {MEASURE_ZONES.map(z => (
                    <span key={z.id} className={m[z.id]?.aplica === false ? 'text-muted-foreground' : ''}>
                        <b>{z.n}. {z.label}:</b> {zoneText(m[z.id])}
                    </span>
                ))}
            </div>
            {m.notes && <p className="italic text-muted-foreground">“{m.notes}”</p>}
        </div>
    );
};

const emptyZone = (applies) => ({ aplica: applies, ancho: '', alto: '', piezas: '' });

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
                ? { aplica: p.aplica !== false, ancho: p.ancho ?? '', alto: p.alto ?? '', piezas: p.piezas ?? '' }
                : emptyZone(applies[z.id]);
            if (z.id === 'laterales' && !next[z.id].piezas) next[z.id].piezas = '4';
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
        return parseFloat(z.ancho) > 0 && parseFloat(z.alto) > 0 ? 'done' : 'pending';
    };
    const status = Object.fromEntries(MEASURE_ZONES.map(z => [z.id, zoneState(z.id)]));
    const update = (id, changes) => setZones(prev => ({ ...prev, [id]: { ...prev[id], ...changes } }));

    const save = async () => {
        const missing = MEASURE_ZONES.filter(z => status[z.id] === 'pending');
        if (missing.length) {
            setActive(missing[0].id);
            toast.error(`Coloca ancho y alto de ${missing.map(z => z.label).join(', ')} o márcalo como No aplica`);
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
                ? { aplica: true, ancho: parseFloat(v.ancho), alto: parseFloat(v.alto), piezas: z.id === 'laterales' ? parseInt(v.piezas, 10) || 1 : null }
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

                <div className="rounded-xl border bg-gradient-to-b from-slate-900 to-slate-950 p-2">
                    <VehicleGlassDiagram status={status} active={active} onSelect={setActive} className="w-full h-auto" />
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
                                {v.aplica && (
                                    <div className={`grid gap-2 ${z.id === 'laterales' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">Ancho (cm)</Label>
                                            <Input type="number" min="1" max="500" inputMode="decimal" value={v.ancho} onChange={(e) => update(z.id, { ancho: e.target.value })} className="h-9" data-testid={`measure-ancho-${z.id}`} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[11px]">Alto (cm)</Label>
                                            <Input type="number" min="1" max="500" inputMode="decimal" value={v.alto} onChange={(e) => update(z.id, { alto: e.target.value })} className="h-9" data-testid={`measure-alto-${z.id}`} />
                                        </div>
                                        {z.id === 'laterales' && (
                                            <div className="space-y-1">
                                                <Label className="text-[11px]">Vidrios</Label>
                                                <Input type="number" min="1" max="10" inputMode="numeric" value={v.piezas} onChange={(e) => update(z.id, { piezas: e.target.value })} className="h-9" data-testid="measure-piezas-laterales" />
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
