import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ordersAPI } from '../lib/api';
import { orderNeedsCutting } from '../lib/workflow';
import { toast } from 'sonner';
import { Scissors, Wrench, UserPlus, ArrowRight } from 'lucide-react';

const selectClass = 'w-full h-10 rounded-md border border-input bg-background px-3 text-sm';

/**
 * Asignar técnico principal y técnico de apoyo. Con Polarizado/PPF/Ultrasecure la orden pasa a Corte
 * y de Corte a Instalación; sin esos servicios queda lista para instalar.
 * Props: order (o null para cerrar), technicians, onClose(), onAssigned()
 */
export const AssignTechniciansDialog = ({ order, technicians = [], onClose, onAssigned }) => {
    const [tech1, setTech1] = useState('');
    const [tech2, setTech2] = useState('');
    const [minutes, setMinutes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!order) return;
        setTech1(order.assigned_technician_id || order.pre_assigned_technician_id || '');
        setTech2(order.assigned_technician_2_id || '');
        setMinutes(order.service_time_minutes ? String(order.service_time_minutes) : '');
    }, [order]);

    if (!order) return null;
    const needsCutting = orderNeedsCutting(order);
    const isFirstAssignment = order.status === 'en_revision';

    const save = async () => {
        if (!tech1) {
            toast.error('Selecciona el técnico principal');
            return;
        }
        if (tech2 && tech2 === tech1) {
            toast.error('El técnico de apoyo debe ser distinto al principal');
            return;
        }
        setSaving(true);
        try {
            const res = await ordersAPI.assignTechnicians(order.id, {
                technician_ids: [tech1, tech2].filter(Boolean),
                service_time_minutes: minutes ? parseInt(minutes, 10) : null,
            });
            const st = res.data?.status;
            toast.success(st === 'en_corte' ? 'Técnicos asignados · el vehículo pasa a Corte'
                : st === 'asignado' ? 'Técnicos asignados · listo para instalación' : 'Técnicos actualizados');
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
            <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()} data-testid="assign-technicians-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl">{isFirstAssignment ? 'Asignar técnicos' : 'Cambiar técnicos'}</DialogTitle>
                    <DialogDescription>{order.plate} · {order.brand} {order.model} · {order.client_name}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1">
                        <Label>Técnico principal *</Label>
                        <select value={tech1} onChange={(e) => setTech1(e.target.value)} className={selectClass} data-testid="assign-tech-1">
                            <option value="">Seleccionar técnico...</option>
                            {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label>Técnico de apoyo</Label>
                        <select value={tech2} onChange={(e) => setTech2(e.target.value)} className={selectClass} data-testid="assign-tech-2">
                            <option value="">Sin técnico de apoyo</option>
                            {technicians.filter(t => t.id !== tech1).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
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
                        <Button className="sm:flex-1 brand-glow" onClick={save} disabled={saving || !tech1} data-testid="assign-technicians-save">
                            <UserPlus className="w-4 h-4 mr-2" />
                            {saving ? 'Asignando...' : 'Confirmar'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AssignTechniciansDialog;
