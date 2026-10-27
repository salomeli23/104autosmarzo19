import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { discountCodesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { TicketPercent, Lock, Plus, Edit, Trash2, Power, Copy, Shuffle, Loader2, Search } from 'lucide-react';

const KIND_LABELS = { cupon: 'Cupón', codigo: 'Código de descuento' };
const FILTERS = [
    { value: 'all', label: 'Todos' },
    { value: 'vigente', label: 'Vigentes' },
    { value: 'inactivo', label: 'Inactivos' },
    { value: 'vencido', label: 'Vencidos / agotados' },
];
const selectClass = 'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';

const codeState = (c) => {
    if (c.expired) return { key: 'vencido', label: 'Vencido', className: 'bg-red-500/15 text-red-500 border-red-500/30' };
    if (c.exhausted) return { key: 'vencido', label: 'Agotado', className: 'bg-red-500/15 text-red-500 border-red-500/30' };
    if (!c.active) return { key: 'inactivo', label: 'Inactivo', className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' };
    return { key: 'vigente', label: 'Vigente', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' };
};

const randomCode = (kind) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const body = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${kind === 'cupon' ? 'CUPON' : 'PYA'}-${body}`;
};

const emptyForm = { kind: 'cupon', code: '', discount_type: 'percentage', discount_value: '', expires_at: '', max_uses: '', notes: '' };

/**
 * Configuración · Cupones y códigos de descuento. Requiere la contraseña de administración de códigos.
 */
export const DiscountCodesSection = () => {
    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [codes, setCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [dialog, setDialog] = useState(null); // { id? }
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await discountCodesAPI.list(true);
            setCodes(res.data || []);
        } catch (e) {
            toast.error('Error al cargar los códigos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (authed) load(); }, [authed, load]);

    const unlock = async () => {
        if (!password) return;
        setVerifying(true);
        try {
            await discountCodesAPI.verifyAdmin(password);
            setAuthed(true);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Contraseña inválida');
        } finally {
            setVerifying(false);
        }
    };

    const visible = useMemo(() => {
        const q = query.trim().toUpperCase();
        return codes.filter(c => (filter === 'all' || codeState(c).key === filter)
            && (!q || c.code.includes(q) || (c.notes || '').toUpperCase().includes(q)));
    }, [codes, filter, query]);

    const openNew = () => {
        setForm({ ...emptyForm, code: randomCode('cupon') });
        setDialog({});
    };

    const openEdit = (c) => {
        setForm({
            kind: c.kind || 'codigo',
            code: c.code,
            discount_type: c.discount_type,
            discount_value: String(c.discount_value ?? ''),
            expires_at: c.expires_at || '',
            max_uses: c.max_uses ? String(c.max_uses) : '',
            notes: c.notes || '',
        });
        setDialog({ id: c.id });
    };

    const save = async () => {
        const value = parseFloat(form.discount_value);
        const maxUses = form.max_uses === '' ? null : parseInt(form.max_uses, 10);
        if (!dialog.id && !form.code.trim()) { toast.error('Escribe el código'); return; }
        if (!(value > 0)) { toast.error('El valor del descuento debe ser mayor a 0'); return; }
        if (form.discount_type === 'percentage' && value > 100) { toast.error('El porcentaje no puede ser mayor a 100'); return; }
        if (maxUses !== null && !(maxUses >= 1)) { toast.error('El límite de usos debe ser al menos 1'); return; }
        const payload = {
            kind: form.kind,
            discount_type: form.discount_type,
            discount_value: value,
            notes: form.notes.trim() || null,
            admin_password: password,
        };
        setSaving(true);
        try {
            if (dialog.id) {
                await discountCodesAPI.update(dialog.id, { ...payload, expires_at: form.expires_at || '', max_uses: maxUses ?? 0 });
                toast.success('Código actualizado');
            } else {
                await discountCodesAPI.create({
                    ...payload,
                    code: form.code.trim().toUpperCase(),
                    expires_at: form.expires_at || null,
                    max_uses: maxUses,
                    active: true,
                });
                toast.success(`${KIND_LABELS[form.kind]} ${form.code.trim().toUpperCase()} creado`);
            }
            setDialog(null);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar');
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (c) => {
        try {
            await discountCodesAPI.update(c.id, { active: !c.active, admin_password: password });
            toast.success(c.active ? 'Código desactivado' : 'Código activado');
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo actualizar');
        }
    };

    const remove = async (c) => {
        if (!window.confirm(`¿Eliminar ${c.code}? Esta acción no se puede deshacer.`)) return;
        try {
            await discountCodesAPI.delete(c.id, password);
            toast.success('Código eliminado');
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo eliminar');
        }
    };

    const copy = async (code) => {
        try {
            await navigator.clipboard.writeText(code);
            toast.success(`${code} copiado`);
        } catch {
            toast.error('No se pudo copiar');
        }
    };

    return (
        <Card className="card-hover border-fuchsia-500/30" data-testid="discount-codes-section">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2">
                    <TicketPercent className="w-5 h-5 text-fuchsia-400" />
                    Cupones y códigos de descuento
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Crea cupones y códigos que los asesores aplican al agendar o en el check-in.
                    Puedes darles fecha de vencimiento y un límite de usos.
                </p>

                {!authed ? (
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                        <div className="space-y-2 flex-1">
                            <Label htmlFor="disc-settings-pwd" className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Contraseña de administración de códigos</Label>
                            <Input
                                id="disc-settings-pwd"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && unlock()}
                                data-testid="disc-settings-password"
                            />
                        </div>
                        <Button onClick={unlock} disabled={verifying || !password} data-testid="disc-settings-unlock">
                            {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                            Desbloquear
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                            <div className="flex flex-wrap gap-2">
                                {FILTERS.map(f => (
                                    <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} onClick={() => setFilter(f.value)}>
                                        {f.label}
                                    </Button>
                                ))}
                            </div>
                            <Button onClick={openNew} data-testid="disc-settings-new">
                                <Plus className="w-4 h-4 mr-2" />
                                Nuevo cupón o código
                            </Button>
                        </div>
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar código o nota" className="pl-9" />
                        </div>

                        {loading ? (
                            <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                        ) : visible.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-6">No hay códigos en esta lista.</p>
                        ) : (
                            <div className="grid md:grid-cols-2 gap-3">
                                {visible.map(c => {
                                    const st = codeState(c);
                                    return (
                                        <div key={c.id} className="p-3 rounded-lg border bg-muted/30 space-y-2" data-testid={`disc-settings-card-${c.code}`}>
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <button type="button" onClick={() => copy(c.code)} className="font-mono font-bold text-lg flex items-center gap-1.5 hover:text-primary" title="Copiar">
                                                        {c.code}
                                                        <Copy className="w-3.5 h-3.5 opacity-60" />
                                                    </button>
                                                    <p className="text-xs text-muted-foreground">{KIND_LABELS[c.kind] || KIND_LABELS.codigo}</p>
                                                </div>
                                                <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${st.className}`}>{st.label}</span>
                                            </div>
                                            <p className="text-2xl font-bold text-fuchsia-400">
                                                {c.discount_type === 'percentage' ? `${c.discount_value}%` : formatCurrency(c.discount_value)}
                                                <span className="text-sm font-normal text-muted-foreground"> de descuento</span>
                                            </p>
                                            <div className="text-xs text-muted-foreground space-y-0.5">
                                                <p>Usos: <b className="text-foreground">{c.usage_count || 0}</b>{c.max_uses ? ` de ${c.max_uses}` : ' · ilimitado'}</p>
                                                <p>{c.expires_at ? `Vence: ${c.expires_at}` : 'Sin vencimiento'}</p>
                                                {c.notes && <p className="italic">{c.notes}</p>}
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" variant="outline" className="flex-1" onClick={() => toggle(c)} data-testid={`disc-settings-toggle-${c.code}`}>
                                                    <Power className="w-3.5 h-3.5 mr-1" />
                                                    {c.active ? 'Desactivar' : 'Activar'}
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={() => openEdit(c)} aria-label="Editar" data-testid={`disc-settings-edit-${c.code}`}>
                                                    <Edit className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button size="sm" variant="outline" className="text-red-500" onClick={() => remove(c)} aria-label="Eliminar">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </CardContent>

            <Dialog open={!!dialog} onOpenChange={(v) => !saving && !v && setDialog(null)}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="disc-settings-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">{dialog?.id ? `Editar ${form.code}` : 'Nuevo cupón o código'}</DialogTitle>
                        <DialogDescription>El código se aplica sobre el subtotal de la orden.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(KIND_LABELS).map(([value, label]) => (
                                <Button
                                    key={value}
                                    type="button"
                                    variant={form.kind === value ? 'default' : 'outline'}
                                    onClick={() => setForm(f => ({
                                        ...f,
                                        kind: value,
                                        code: !dialog?.id && (!f.code || f.code.startsWith('CUPON-') || f.code.startsWith('PYA-')) ? randomCode(value) : f.code,
                                    }))}
                                    data-testid={`disc-kind-${value}`}
                                >
                                    {label}
                                </Button>
                            ))}
                        </div>
                        <div className="space-y-1">
                            <Label>Código *</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={form.code}
                                    disabled={!!dialog?.id}
                                    onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                                    className="font-mono"
                                    data-testid="disc-settings-code"
                                />
                                {!dialog?.id && (
                                    <Button type="button" variant="outline" onClick={() => setForm(f => ({ ...f, code: randomCode(f.kind) }))} aria-label="Generar código">
                                        <Shuffle className="w-4 h-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Tipo</Label>
                                <select value={form.discount_type} onChange={(e) => setForm(f => ({ ...f, discount_type: e.target.value }))} className={selectClass} data-testid="disc-settings-type">
                                    <option value="percentage">Porcentaje (%)</option>
                                    <option value="fixed">Valor fijo ($)</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label>{form.discount_type === 'percentage' ? 'Porcentaje *' : 'Valor *'}</Label>
                                <Input type="number" min="0" value={form.discount_value} onChange={(e) => setForm(f => ({ ...f, discount_value: e.target.value }))} data-testid="disc-settings-value" />
                            </div>
                            <div className="space-y-1">
                                <Label>Vence</Label>
                                <Input type="date" value={form.expires_at} onChange={(e) => setForm(f => ({ ...f, expires_at: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label>Límite de usos</Label>
                                <Input type="number" min="1" value={form.max_uses} onChange={(e) => setForm(f => ({ ...f, max_uses: e.target.value }))} placeholder="Ilimitado" data-testid="disc-settings-max-uses" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Ej. Campaña de diciembre" />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setDialog(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={save} disabled={saving} data-testid="disc-settings-save">
                                {saving ? 'Guardando...' : 'Guardar'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

export default DiscountCodesSection;
