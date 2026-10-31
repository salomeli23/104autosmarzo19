import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cuttingAPI, cuttingCatalogAPI } from '../lib/api';
import { toast } from 'sonner';
import { Recycle, Plus, Trash2, Loader2 } from 'lucide-react';
import { TypeAheadSelect } from './TypeAheadSelect';

const selectClass = 'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';
const emptyForm = { referencia: '', largo_cm: '', ancho_cm: '', notes: '' };

/**
 * Piezas reutilizables de Corte: retazos de cualquier referencia que quedan guardados para próximos cortes.
 * Al completar un corte, si la referencia tiene piezas disponibles, se muestra la alerta para usarlas.
 * Props: open, onOpenChange(v), onChanged(pieces)
 */
export const ReusablePiecesDialog = ({ open, onOpenChange, onChanged }) => {
    const [pieces, setPieces] = useState([]);
    const [groups, setGroups] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('');

    const load = () => cuttingAPI.reusablePieces()
        .then(res => { setPieces(res.data || []); onChanged?.(res.data || []); })
        .catch(() => toast.error('No se pudieron cargar las piezas reutilizables'));

    useEffect(() => {
        if (!open) return;
        load();
        if (!groups.length) cuttingCatalogAPI.getMaterials().then(res => setGroups(res.data?.groups || [])).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const byRef = useMemo(() => {
        const q = filter.trim().toLowerCase();
        const map = {};
        pieces.filter(p => !q || p.referencia.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
            .forEach(p => { (map[p.referencia] = map[p.referencia] || []).push(p); });
        return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    }, [pieces, filter]);

    const save = async () => {
        if (!form.referencia) { toast.error('Elige la referencia de la pieza'); return; }
        if (!(parseFloat(form.largo_cm) > 0)) { toast.error('Escribe el largo de la pieza en cm'); return; }
        setSaving(true);
        try {
            const res = await cuttingAPI.createReusablePiece({
                referencia: form.referencia,
                largo_cm: parseFloat(form.largo_cm),
                ancho_cm: parseFloat(form.ancho_cm) > 0 ? parseFloat(form.ancho_cm) : null,
                notes: form.notes.trim() || null,
            });
            toast.success(`Pieza ${res.data.codigo} registrada · ${res.data.referencia}`);
            // Se mantiene la referencia para registrar varias piezas seguidas
            setForm({ ...emptyForm, referencia: form.referencia });
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo registrar la pieza');
        } finally {
            setSaving(false);
        }
    };

    const discard = async (p) => {
        if (!window.confirm(`¿Descartar la pieza ${p.codigo} (${p.referencia})? Ya no aparecerá en las alertas de corte.`)) return;
        try {
            await cuttingAPI.discardReusablePiece(p.id);
            toast.success(`Pieza ${p.codigo} descartada`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo descartar la pieza');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="reusable-pieces-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl flex items-center gap-2">
                        <Recycle className="w-5 h-5 text-emerald-400" /> Piezas reutilizables
                    </DialogTitle>
                    <DialogDescription>
                        Registra los retazos que sobran de cualquier referencia. Al hacer un corte de esa referencia aparece una alerta para usarlos antes de cortar del rollo.
                    </DialogDescription>
                </DialogHeader>

                <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-3">
                    <p className="text-sm font-medium">Registrar pieza</p>
                    <div className="space-y-1">
                        <Label className="text-xs">Referencia *</Label>
                        <TypeAheadSelect value={form.referencia} onChange={(v) => setForm(f => ({ ...f, referencia: v }))}
                            options={groups.flatMap(g => g.items.map(it => ({ value: it, label: it, group: g.label })))}
                            placeholder="Seleccionar referencia… (escribe las primeras letras)"
                            className={selectClass} data-testid="piece-referencia" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Largo (cm) *</Label>
                            <Input type="number" min="1" inputMode="decimal" value={form.largo_cm}
                                onChange={(e) => setForm(f => ({ ...f, largo_cm: e.target.value }))} data-testid="piece-largo" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Ancho (cm)</Label>
                            <Input type="number" min="1" inputMode="decimal" value={form.ancho_cm}
                                onChange={(e) => setForm(f => ({ ...f, ancho_cm: e.target.value }))} data-testid="piece-ancho" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Nota</Label>
                        <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional: de qué corte salió, dónde está guardada…" />
                    </div>
                    <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700" data-testid="piece-save">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Registrar pieza reutilizable
                    </Button>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">Disponibles ({pieces.length})</p>
                        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar referencia o código" className="h-8 w-56" />
                    </div>
                    {byRef.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">No hay piezas reutilizables disponibles.</p>
                    ) : byRef.map(([ref, list]) => (
                        <div key={ref} className="rounded-lg border p-2 space-y-1" data-testid={`pieces-ref-${ref}`}>
                            <p className="text-xs font-semibold text-emerald-400">{ref} · {list.length} pieza(s)</p>
                            {list.map(p => (
                                <div key={p.id} className="flex items-center gap-2 text-xs">
                                    <span className="font-mono">{p.codigo}</span>
                                    <span>{p.largo_cm}{p.ancho_cm ? ` × ${p.ancho_cm}` : ''} cm</span>
                                    <span className="flex-1 min-w-0 truncate text-muted-foreground">{p.notes || ''} · {p.created_by_name}</span>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => discard(p)} aria-label="Descartar pieza">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ReusablePiecesDialog;
