import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { ordersAPI, servicesAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { FilePenLine, Plus, Trash2, Lock } from 'lucide-react';

const ALLOWED_ROLES = ['admin', 'asesor', 'coordinador'];
const LOCKED_STATUSES = ['entregado', 'desistimiento'];

let nextKey = 1;
const splitDescription = (svc) => {
    const parts = (svc.description || '').split(' - ');
    return parts.length > 1
        ? { category: parts[0], name: parts.slice(1).join(' - ') }
        : { category: 'Servicio', name: svc.description || svc.service };
};
const rowFromService = (svc) => ({
    key: `row-${nextKey++}`,
    base: svc,
    ...splitDescription(svc),
    price: String(svc.price ?? 0),
    no_charge: !!svc.no_charge,
});
const extrasSum = (svc) => (svc?.extras || []).reduce((s, e) => s + (parseFloat(e?.price) || 0), 0);

/**
 * Botón "Actualizar orden": abre un diálogo para agregar/quitar servicios o cambiar
 * sus valores. Requiere contraseña. Solo para admin, asesor y coordinador.
 * Props: order, onUpdated(order), className, size
 */
export const UpdateOrderButton = ({ order, onUpdated, className, size = 'sm' }) => {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [catalog, setCatalog] = useState({});
    const [rows, setRows] = useState([]);
    const [catalogPick, setCatalogPick] = useState('');
    const [customName, setCustomName] = useState('');
    const [customPrice, setCustomPrice] = useState('');
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setRows((order.services || []).filter(s => typeof s === 'object').map(rowFromService));
        setCatalogPick('');
        setCustomName('');
        setCustomPrice('');
        setPassword('');
        setReason('');
        if (Object.keys(catalog).length === 0) {
            servicesAPI.getCatalog().then(res => setCatalog(res.data || {})).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!order || !ALLOWED_ROLES.includes(user?.role) || LOCKED_STATUSES.includes(order.status)) return null;

    const isPostventa = !!order.is_postventa;
    const total = rows.reduce((sum, r) => sum + (r.no_charge ? 0 : (parseFloat(r.price) || 0)) + extrasSum(r.base), 0);

    const updateRow = (key, changes) => setRows(prev => prev.map(r => (r.key === key ? { ...r, ...changes } : r)));

    const addCatalogService = () => {
        if (!catalogPick) return;
        const [catKey, svcId] = catalogPick.split('::');
        const cat = catalog[catKey];
        const svc = cat?.services?.find(s => s.id === svcId);
        if (!svc) return;
        setRows(prev => [...prev, {
            key: `row-${nextKey++}`, base: null, service: svc.id,
            category: cat.name, name: svc.name, price: '0', no_charge: false,
        }]);
        setCatalogPick('');
    };

    const addCustomService = () => {
        if (!customName.trim()) {
            toast.error('Escribe el nombre del servicio');
            return;
        }
        setRows(prev => [...prev, {
            key: `row-${nextKey++}`, base: null, service: 'personalizado',
            category: 'Personalizado', name: customName.trim(), price: customPrice || '0', no_charge: false,
        }]);
        setCustomName('');
        setCustomPrice('');
    };

    const handleSave = async () => {
        if (rows.length === 0) {
            toast.error('La orden debe tener al menos un servicio');
            return;
        }
        if (rows.some(r => (parseFloat(r.price) || 0) < 0)) {
            toast.error('El valor de un servicio no puede ser negativo');
            return;
        }
        if (!password.trim()) {
            toast.error('Ingresa la contraseña para actualizar la orden');
            return;
        }
        const services = rows.map(r => {
            const price = r.no_charge ? 0 : (parseFloat(r.price) || 0);
            const noCharge = isPostventa ? r.no_charge : null;
            return r.base
                ? { ...r.base, price, no_charge: noCharge }
                : { service: r.service, description: `${r.category} - ${r.name}`, price, no_charge: noCharge };
        });
        setSaving(true);
        try {
            const res = await ordersAPI.updateServices(order.id, { services, password: password.trim(), reason: reason.trim() || null });
            toast.success('Orden actualizada');
            setOpen(false);
            onUpdated?.(res.data.order);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo actualizar la orden');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size={size}
                className={`border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 ${className || ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                data-testid={`update-order-btn-${order.id}`}
            >
                <FilePenLine className="w-3.5 h-3.5 mr-1" />
                Actualizar orden
            </Button>

            <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="update-order-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Actualizar orden</DialogTitle>
                        <DialogDescription>
                            {order.plate} · {order.client_name} · {order.order_code}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Servicios de la orden</Label>
                            {rows.length === 0 && (
                                <p className="text-sm text-muted-foreground">No hay servicios. Agrega al menos uno.</p>
                            )}
                            {rows.map((r, idx) => (
                                <div key={r.key} className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30" data-testid={`update-order-row-${idx}`}>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{r.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {r.category}
                                            {extrasSum(r.base) > 0 && ` · extras ${formatCurrency(extrasSum(r.base))}`}
                                            {!r.base && ' · nuevo'}
                                        </p>
                                    </div>
                                    {isPostventa && (
                                        <label className="flex items-center gap-1 text-xs whitespace-nowrap cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={r.no_charge}
                                                onChange={(e) => updateRow(r.key, { no_charge: e.target.checked, price: e.target.checked ? '0' : r.price })}
                                                className="w-4 h-4 accent-amber-500"
                                            />
                                            Sin pago
                                        </label>
                                    )}
                                    <span className="text-sm text-muted-foreground">$</span>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={r.no_charge ? '0' : r.price}
                                        disabled={r.no_charge}
                                        onChange={(e) => updateRow(r.key, { price: e.target.value })}
                                        className="w-28 h-8 text-right"
                                        data-testid={`update-order-price-${idx}`}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-500 hover:text-red-600"
                                        onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}
                                        aria-label="Quitar servicio"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-2">
                            <Label>Agregar servicio del catálogo</Label>
                            <div className="flex gap-2">
                                <select
                                    value={catalogPick}
                                    onChange={(e) => setCatalogPick(e.target.value)}
                                    className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                                    data-testid="update-order-catalog-select"
                                >
                                    <option value="">Seleccionar servicio...</option>
                                    {Object.entries(catalog).map(([catKey, cat]) => (
                                        <optgroup key={catKey} label={cat.name}>
                                            {(cat.services || []).map(s => (
                                                <option key={s.id} value={`${catKey}::${s.id}`}>{s.name}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                <Button type="button" variant="outline" onClick={addCatalogService} disabled={!catalogPick} data-testid="update-order-add-catalog">
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Agregar servicio o producto personalizado</Label>
                            <div className="flex gap-2">
                                <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Nombre" className="flex-1" />
                                <Input type="number" min="0" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="Valor" className="w-28" />
                                <Button type="button" variant="outline" onClick={addCustomService} data-testid="update-order-add-custom">
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                            <span className="text-muted-foreground text-sm">Subtotal de servicios</span>
                            <span className="font-mono font-bold text-lg text-primary" data-testid="update-order-total">{formatCurrency(total)}</span>
                        </div>
                        {(order.discount_type || order.requires_invoice) && (
                            <p className="text-xs text-muted-foreground -mt-2">
                                Al guardar se vuelven a aplicar {[order.discount_type && 'el descuento', order.requires_invoice && order.final_value != null && 'el IVA'].filter(Boolean).join(' y ')} de la orden.
                            </p>
                        )}

                        <div className="space-y-2">
                            <Label>Motivo del cambio</Label>
                            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" rows={2} />
                        </div>

                        <div className="space-y-2">
                            <Label className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Contraseña *</Label>
                            <Input
                                type="password"
                                inputMode="numeric"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Contraseña para actualizar"
                                data-testid="update-order-password"
                            />
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="outline" className="sm:flex-1" onClick={() => setOpen(false)} disabled={saving}>
                                Cancelar
                            </Button>
                            <Button type="button" className="sm:flex-1 brand-glow" onClick={handleSave} disabled={saving} data-testid="update-order-save">
                                {saving ? 'Guardando...' : 'Guardar cambios'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default UpdateOrderButton;
