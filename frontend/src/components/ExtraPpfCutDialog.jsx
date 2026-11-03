import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { TypeAheadSelect } from './TypeAheadSelect';
import { cuttingAPI, cuttingCatalogAPI, inventoryAPI } from '../lib/api';
import { toast } from 'sonner';
import { Scissors, Plus, Trash2, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';

const fmtM = (m) => `${(Math.round(m * 100) / 100).toFixed(2).replace('.', ',')} m`;
// "1,20" o "1.2" → metros; "120 cm" → 1,20 m
const toMeters = (txt) => {
    const t = String(txt || '').trim().toLowerCase().replace(',', '.');
    const n = parseFloat(t);
    if (!(n > 0)) return 0;
    return t.includes('cm') || n > 20 ? n / 100 : n;
};
let key = 0;
const newLine = (part = '') => ({ key: `x${key++}`, part, material: '', inventory_item_id: '', medida: '', reutilizable: false });

/**
 * Corte de PPF adicional durante el servicio (pieza dañada, parte extra…). Lo aprueba un coordinador con su PIN.
 * Props: order (con ppf_plan), onClose(), onDone()
 */
export const ExtraPpfCutDialog = ({ order, onClose, onDone }) => {
    const [lines, setLines] = useState([]);
    const [reason, setReason] = useState('');
    const [pin, setPin] = useState('');
    const [rolls, setRolls] = useState([]);
    const [catalog, setCatalog] = useState(null);
    const [extraOk, setExtraOk] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!order) return;
        setLines([newLine(order.ppf_plan?.scope === 'full' ? 'Full Body' : (order.ppf_plan?.parts || [])[0] || '')]);
        setReason('');
        setPin('');
        setExtraOk(false);
        inventoryAPI.list({ tipo_articulo: 'rollo' })
            .then(res => setRolls((res.data || []).filter(r => (r.metros_restantes ?? 0) > 0 && r.en_stock_corte !== false)
                .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }))))
            .catch(() => setRolls([]));
        if (!catalog) cuttingCatalogAPI.getMaterials().then(res => setCatalog(res.data)).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    if (!order) return null;

    const groups = catalog?.groups || [];
    const ppfGroups = groups.filter(g => g.categoria === 'ppf');
    const ppfRefs = new Set((ppfGroups.length ? ppfGroups : groups).flatMap(g => g.items));
    const materialOptions = (ppfGroups.length ? ppfGroups : groups).flatMap(g => g.items.map(it => ({ value: it, label: it, group: g.label })));
    const ppfRolls = rolls.filter(r => !ppfRefs.size || ppfRefs.has(r.tipo_rollo));
    const rollOptions = ppfRolls.map(r => ({ value: r.id, label: `${r.nombre} · ${fmtM(r.metros_restantes || 0)} disp. · ${r.codigo}` }));
    const rollById = (id) => rolls.find(r => r.id === id);
    const partOptions = [...(order.ppf_plan?.scope === 'full' ? ['Full Body'] : (order.ppf_plan?.parts || [])), 'Otra parte'];

    const update = (k, patch) => setLines(prev => prev.map(l => {
        if (l.key !== k) return l;
        const next = { ...l, ...patch };
        // Al elegir el material se propone el rollo de esa referencia
        if (patch.material !== undefined && !patch.inventory_item_id) {
            const current = rollById(l.inventory_item_id);
            if (!current || current.tipo_rollo !== patch.material) {
                next.inventory_item_id = ppfRolls.find(r => r.tipo_rollo === patch.material)?.id || '';
            }
        }
        return next;
    }));

    const perRoll = {};
    lines.forEach(l => {
        if (l.reutilizable || !l.inventory_item_id) return;
        perRoll[l.inventory_item_id] = (perRoll[l.inventory_item_id] || 0) + toMeters(l.medida);
    });
    const overRolls = Object.entries(perRoll).filter(([id, m]) => (rollById(id)?.metros_restantes ?? 0) + 1e-6 < m);
    const incomplete = lines.some(l => !l.part.trim() || !l.material || !(toMeters(l.medida) > 0) || (!l.reutilizable && !l.inventory_item_id));
    const canSave = !saving && lines.length > 0 && !incomplete && reason.trim().length >= 3 && pin.length >= 4
        && (overRolls.length === 0 || extraOk);

    const submit = async () => {
        setSaving(true);
        try {
            const res = await cuttingAPI.extraPpfCut(order.id, {
                pin,
                reason: reason.trim(),
                confirm_extra_cut: overRolls.length > 0 && extraOk,
                lines: lines.map(l => ({
                    part: l.part.trim(), material: l.material, metros: Math.round(toMeters(l.medida) * 100) / 100,
                    inventory_item_id: l.reutilizable ? null : l.inventory_item_id, reutilizable: l.reutilizable,
                })),
            });
            const ded = res.data?.inventory_deduction || [];
            toast.success(`Corte adicional registrado${ded.length ? ' · ' + ded.map(d => `${d.rollo_codigo}: -${d.meters_used} m (quedan ${d.new_remaining} m)`).join(' · ') : ''}`);
            ded.filter(d => d.dado_de_baja).forEach(d => toast.warning(`Rollo ${d.rollo_codigo} agotado: se dio de baja`));
            onDone?.();
            onClose?.();
        } catch (e) {
            const det = e.response?.data?.detail;
            toast.error(typeof det === 'string' ? det : 'No se pudo registrar el corte adicional');
            setPin('');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!order} onOpenChange={(v) => !v && !saving && onClose?.()}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="extra-ppf-cut-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scissors className="w-5 h-5 text-purple-400" /> Corte adicional de PPF</DialogTitle>
                    <DialogDescription>
                        {order.plate} · {order.brand} {order.model} · {order.client_name}. Se descuenta del rollo y lo aprueba un coordinador con su PIN.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border border-purple-500/40 bg-purple-500/10 p-3 text-sm">
                    <p className="text-xs text-purple-300">PPF comprado</p>
                    <p className="font-heading text-lg">{order.ppf_plan?.scope === 'full' ? 'Full Body' : `Partes: ${(order.ppf_plan?.parts || []).join(' · ')}`}</p>
                </div>

                <div className="space-y-3">
                    {lines.map((l, i) => {
                        const isOther = !partOptions.slice(0, -1).includes(l.part);
                        return (
                            <div key={l.key} className="rounded-lg border p-3 space-y-2" data-testid={`extra-line-${i}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-medium">Corte {i + 1}</p>
                                    {lines.length > 1 && (
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} aria-label="Quitar corte">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                                <div className="grid sm:grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Parte</Label>
                                        <select value={isOther ? 'Otra parte' : l.part} onChange={(e) => update(l.key, { part: e.target.value === 'Otra parte' ? '' : e.target.value })}
                                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                                            {partOptions.map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                        {isOther && <Input value={l.part} onChange={(e) => update(l.key, { part: e.target.value })} placeholder="Escribe la parte (ej. Puerta trasera)" className="h-8 text-sm" />}
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Material PPF</Label>
                                        <TypeAheadSelect value={l.material} onChange={(v) => update(l.key, { material: v })} options={materialOptions}
                                            placeholder="Seleccionar PPF… (escribe)" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Rollo</Label>
                                        <TypeAheadSelect value={l.inventory_item_id} onChange={(v) => update(l.key, { inventory_item_id: v })} options={rollOptions}
                                            disabled={l.reutilizable} placeholder="Elige el rollo" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Corte lineal</Label>
                                        <Input value={l.medida} onChange={(e) => update(l.key, { medida: e.target.value })} placeholder="Ej. 1,20 m o 120 cm" className="h-9 font-mono" />
                                        {toMeters(l.medida) > 0 && <p className="text-xs text-muted-foreground">{fmtM(toMeters(l.medida))}</p>}
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input type="checkbox" checked={l.reutilizable} onChange={(e) => update(l.key, { reutilizable: e.target.checked, inventory_item_id: e.target.checked ? '' : l.inventory_item_id })} className="w-4 h-4" />
                                    Sale de material reutilizable (no descuenta del rollo)
                                </label>
                            </div>
                        );
                    })}
                    <Button variant="outline" size="sm" onClick={() => setLines(prev => [...prev, newLine()])}><Plus className="w-4 h-4 mr-1" /> Agregar otro corte</Button>
                </div>

                {Object.keys(perRoll).length > 0 && (
                    <div className="rounded-lg border p-3 text-sm space-y-1">
                        <p className="font-medium">Se descontará del inventario</p>
                        {Object.entries(perRoll).map(([id, m]) => {
                            const r = rollById(id);
                            const left = (r?.metros_restantes ?? 0) - m;
                            return (
                                <p key={id} className={`text-xs flex justify-between gap-2 ${left < 0 ? 'text-orange-400' : ''}`}>
                                    <span>{r?.codigo} · {r?.nombre}</span>
                                    <span className="font-mono">-{fmtM(m)} · quedan {left < 0 ? `-${fmtM(-left)}` : fmtM(left)}</span>
                                </p>
                            );
                        })}
                        {overRolls.length > 0 && (
                            <label className="mt-2 flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={extraOk} onChange={(e) => setExtraOk(e.target.checked)} className="mt-0.5 w-4 h-4 accent-orange-500" />
                                <span><AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-orange-300" /><b className="text-orange-300">Corte extradimensional.</b> El rollo no alcanza por metros;
                                    solo se permite 1 corte así por rollo: quedará en negativo y se dará de baja.</span>
                            </label>
                        )}
                    </div>
                )}

                <div className="space-y-1">
                    <Label>Motivo del corte adicional *</Label>
                    <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. la pieza del capot se dañó al instalar" data-testid="extra-reason" />
                </div>

                <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3 space-y-2">
                    <Label className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-cyan-400" /> PIN de coordinador *</Label>
                    <Input type="password" inputMode="numeric" autoComplete="off" maxLength={10} value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="El coordinador digita su PIN" className="max-w-xs font-mono" data-testid="extra-pin" />
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <Button variant="outline" className="sm:flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
                    <Button className="sm:flex-1 bg-purple-600 hover:bg-purple-700" onClick={submit} disabled={!canSave} data-testid="extra-submit">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                        Aprobar y registrar corte
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ExtraPpfCutDialog;
