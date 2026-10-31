import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ordersAPI } from '../lib/api';
import { orderNeedsCutting, orderTechnicians, orderServiceAreas, TECH_SERVICE_AREAS, MAX_TECHNICIANS, techAreaLabel } from '../lib/workflow';
import { toast } from 'sonner';
import { Scissors, Wrench, UserPlus, ArrowRight, Plus, Trash2 } from 'lucide-react';

const selectClass = 'w-full h-10 rounded-md border border-input bg-background px-3 text-sm';
let rowKey = 1;
const newRow = (id = '', services = []) => ({ key: `r${rowKey++}`, id, services });

/**
 * Asignar hasta 6 técnicos; cada uno se escoge para uno o varios servicios (Polarizado, PPF, Ultrasecure,
 * Accesorios, Detailing). Con Polarizado/PPF/Ultrasecure la orden pasa a Corte y de Corte a Instalación;
 * sin esos servicios queda lista para instalar.
 * Props: order (o null para cerrar), technicians, onClose(), onAssigned()
 */
export const AssignTechniciansDialog = ({ order, technicians = [], onClose, onAssigned }) => {
    const [rows, setRows] = useState([newRow()]);
    const [minutes, setMinutes] = useState('');
    const [saving, setSaving] = useState(false);

    const purchased = order ? orderServiceAreas(order) : [];

    useEffect(() => {
        if (!order) return;
        const current = orderTechnicians(order);
        const pre = order.pre_assigned_technician_id;
        setRows(current.length ? current.map(t => newRow(t.id, t.services || []))
            : [newRow(pre || '', pre ? suggestFor(pre) : [])]);
        setMinutes(order.service_time_minutes ? String(order.service_time_minutes) : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    if (!order) return null;
    const needsCutting = orderNeedsCutting(order);
    const isFirstAssignment = order.status === 'en_revision';

    // Servicios sugeridos: los que compró el cliente y el técnico sabe hacer (o todos los comprados si no tiene roles)
    function suggestFor(techId) {
        const tech = technicians.find(t => t.id === techId);
        const skills = (tech?.tecnico_roles || []).map(r => (r === 'ceramico' || r === 'lavado' ? 'detailing' : r));
        const bought = order ? orderServiceAreas(order) : [];
        const match = bought.filter(a => skills.includes(a));
        return match.length ? match : bought.length === 1 ? bought : [];
    }

    const update = (key, changes) => setRows(prev => prev.map(r => (r.key === key ? { ...r, ...changes } : r)));
    const toggleArea = (key, area) => setRows(prev => prev.map(r => (r.key !== key ? r : {
        ...r, services: r.services.includes(area) ? r.services.filter(a => a !== area) : [...r.services, area],
    })));
    const chosen = rows.map(r => r.id).filter(Boolean);
    const filled = rows.filter(r => r.id);
    const uncovered = purchased.filter(a => !filled.some(r => r.services.includes(a)));

    const save = async () => {
        if (!filled.length) {
            toast.error('Selecciona al menos un técnico');
            return;
        }
        const noArea = filled.find(r => !r.services.length);
        if (noArea) {
            toast.error(`Elige el servicio de ${technicians.find(t => t.id === noArea.id)?.name || 'cada técnico'}`);
            return;
        }
        setSaving(true);
        try {
            const res = await ordersAPI.assignTechnicians(order.id, {
                assignments: filled.map(r => ({ technician_id: r.id, services: r.services })),
                service_time_minutes: minutes ? parseInt(minutes, 10) : null,
            });
            const st = res.data?.status;
            toast.success(st === 'en_corte' ? `${filled.length} técnico(s) asignado(s) · el vehículo pasa a Corte`
                : st === 'asignado' ? `${filled.length} técnico(s) asignado(s) · listo para instalación` : 'Técnicos actualizados');
            onAssigned?.();
            onClose?.();
        } catch (e) {
            const d = e.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'No se pudo asignar');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!order} onOpenChange={(v) => !v && !saving && onClose?.()}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="assign-technicians-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl">{isFirstAssignment ? 'Asignar técnicos' : 'Cambiar técnicos'}</DialogTitle>
                    <DialogDescription>{order.plate} · {order.brand} {order.model} · {order.client_name}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {purchased.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Servicios comprados: {purchased.map(a => <b key={a} className="text-foreground mr-2">{techAreaLabel(a)}</b>)}
                        </p>
                    )}

                    <div className="space-y-2">
                        {rows.map((r, idx) => (
                            <div key={r.key} className="p-3 rounded-lg border space-y-2" data-testid={`assign-row-${idx}`}>
                                <div className="flex items-end gap-2">
                                    <div className="flex-1 space-y-1">
                                        <Label className="text-xs">Técnico {idx + 1}{idx === 0 ? ' *' : ''}</Label>
                                        <select value={r.id} onChange={(e) => update(r.key, { id: e.target.value, services: e.target.value ? suggestFor(e.target.value) : [] })}
                                            className={selectClass} data-testid={`assign-tech-${idx + 1}`}>
                                            <option value="">Seleccionar técnico...</option>
                                            {technicians.filter(t => t.id === r.id || !chosen.includes(t.id)).map(t => (
                                                <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {rows.length > 1 && (
                                        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-red-500"
                                            onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))} aria-label="Quitar técnico">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                                {r.id && (
                                    <div className="flex flex-wrap gap-1.5" data-testid={`assign-areas-${idx + 1}`}>
                                        {TECH_SERVICE_AREAS.map(a => {
                                            const on = r.services.includes(a.id);
                                            return (
                                                <button key={a.id} type="button" onClick={() => toggleArea(r.key, a.id)}
                                                    className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${on
                                                        ? 'bg-primary text-primary-foreground border-primary'
                                                        : purchased.includes(a.id) ? 'border-primary/50 text-foreground hover:bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
                                                    data-testid={`assign-area-${idx + 1}-${a.id}`}>
                                                    {a.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                        {rows.length < MAX_TECHNICIANS && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setRows(prev => [...prev, newRow()])} data-testid="assign-add-tech">
                                <Plus className="w-4 h-4 mr-1" /> Agregar técnico ({rows.length}/{MAX_TECHNICIANS})
                            </Button>
                        )}
                        {filled.length > 0 && uncovered.length > 0 && (
                            <p className="text-xs text-amber-400">Sin técnico para: {uncovered.map(techAreaLabel).join(', ')}</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <Label>Tiempo estimado de instalación (min)</Label>
                        <Input type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="60" />
                    </div>

                    {isFirstAssignment && (
                        <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 flex-wrap ${needsCutting ? 'border-pink-500/40 bg-pink-500/10 text-pink-400' : 'border-orange-500/40 bg-orange-500/10 text-orange-400'}`} data-testid="assign-next-step">
                            <span>Siguiente paso:</span>
                            {needsCutting ? (
                                <>
                                    <span className="inline-flex items-center gap-1 font-medium"><Scissors className="w-4 h-4" /> Corte</span>
                                    <ArrowRight className="w-4 h-4" />
                                    <span className="inline-flex items-center gap-1 font-medium"><Wrench className="w-4 h-4" /> Instalación</span>
                                </>
                            ) : (
                                <span className="inline-flex items-center gap-1 font-medium"><Wrench className="w-4 h-4" /> Instalación (no requiere corte)</span>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button variant="outline" className="sm:flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
                        <Button className="sm:flex-1 brand-glow" onClick={save} disabled={saving || !filled.length} data-testid="assign-technicians-save">
                            <UserPlus className="w-4 h-4 mr-2" />
                            {saving ? 'Asignando...' : `Confirmar (${filled.length})`}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AssignTechniciansDialog;
