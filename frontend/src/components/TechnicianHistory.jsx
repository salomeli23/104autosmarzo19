import React, { useState } from 'react';
import { technicianChargesAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { PlateBadge } from './PlateBadge';
import { CarAvatar } from './CarAvatar';
import { QualityTag, QualityComments } from './QualityTag';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { HandCoins, Loader2, CheckCircle, Clock, XCircle, Wallet, History } from 'lucide-react';

export const CHARGE_META = {
    pendiente: { label: 'Cobro en revisión', icon: Clock, className: 'bg-amber-500/15 text-amber-400 border-amber-500/40' },
    aprobado: { label: 'Cobro aprobado', icon: CheckCircle, className: 'bg-sky-500/15 text-sky-400 border-sky-500/40' },
    rechazado: { label: 'Cobro rechazado', icon: XCircle, className: 'bg-red-500/15 text-red-400 border-red-500/40' },
    pagado: { label: 'Pagado', icon: Wallet, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
};

export const ChargeBadge = ({ charge, testId }) => {
    if (!charge) return null;
    const meta = CHARGE_META[charge.status] || CHARGE_META.pendiente;
    const Icon = meta.icon;
    const amount = charge.status === 'aprobado' || charge.status === 'pagado' ? charge.approved_amount : charge.amount;
    return (
        <Badge className={`gap-1 ${meta.className}`} data-testid={testId}>
            <Icon className="w-3 h-3" /> {meta.label} · {formatCurrency(amount)}
        </Badge>
    );
};

const digits = (v) => String(v || '').replace(/\D/g, '');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '-');

const ChargeDialog = ({ item, onClose, onSaved }) => {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const value = Number(digits(amount) || 0);

    const save = async () => {
        if (value <= 0) { toast.error('Escribe el valor a cobrar'); return; }
        setSaving(true);
        try {
            await technicianChargesAPI.create({ order_id: item.id, amount: value, notes: notes.trim() || null });
            toast.success('Cobro enviado al coordinador de liquidaciones');
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar el cobro');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
            <DialogContent data-testid="charge-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-emerald-400" /> Cobrar servicio</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 flex-wrap">
                        <PlateBadge plate={item.plate} size="sm" /> {item.brand} {item.model}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="text-sm space-y-1">
                        <p className="text-muted-foreground">Servicios instalados:</p>
                        <ul className="list-disc pl-5">{item.installed_services.map(s => <li key={s}>{s}</li>)}</ul>
                    </div>
                    {item.charge?.status === 'rechazado' && (
                        <p className="text-xs p-2 rounded border border-red-500/40 bg-red-500/10 text-red-300">
                            Cobro anterior rechazado: {item.charge.review_notes}
                        </p>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="charge-amount">Valor a cobrar *</Label>
                        <Input
                            id="charge-amount"
                            inputMode="numeric"
                            value={value ? `$ ${value.toLocaleString('es-CO')}` : ''}
                            onChange={(e) => setAmount(digits(e.target.value))}
                            placeholder="$ 0"
                            className="text-lg font-mono"
                            data-testid="charge-amount"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="charge-notes">Nota (opcional)</Label>
                        <Textarea id="charge-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                            placeholder="Ej.: incluye desmonte de película anterior" data-testid="charge-notes" />
                    </div>
                    <Button className="w-full" onClick={save} disabled={saving || value <= 0} data-testid="charge-submit">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <HandCoins className="w-4 h-4 mr-2" />}
                        Enviar cobro a liquidaciones
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

/** Historial de servicios terminados del técnico, con etiqueta de calidad y cobro */
export const TechnicianHistory = ({ items = [], onChanged }) => {
    const [charging, setCharging] = useState(null);

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground text-sm">
                <History className="w-10 h-10 mx-auto mb-2 opacity-50" />
                Aún no tienes servicios terminados
            </div>
        );
    }

    const totals = items.reduce((acc, it) => {
        const c = it.charge;
        if (c?.status === 'pagado') acc.paid += c.approved_amount || 0;
        else if (c?.status === 'aprobado') acc.approved += c.approved_amount || 0;
        else if (c?.status === 'pendiente') acc.pending += c.amount || 0;
        return acc;
    }, { pending: 0, approved: 0, paid: 0 });

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center" data-testid="charge-totals">
                {[['En revisión', totals.pending, 'text-amber-400'], ['Aprobado', totals.approved, 'text-sky-400'], ['Pagado', totals.paid, 'text-emerald-400']].map(([l, v, c]) => (
                    <div key={l} className="p-2 rounded-lg border border-border">
                        <p className="text-[10px] uppercase text-muted-foreground">{l}</p>
                        <p className={`font-mono text-sm ${c}`}>{formatCurrency(v)}</p>
                    </div>
                ))}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
                {items.map(it => {
                    const canCharge = !it.charge || it.charge.status === 'rechazado';
                    return (
                        <Card key={it.id} data-testid={`history-card-${it.id}`}>
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    <CarAvatar photoUrl={it.profile_photo_url} size={40} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <PlateBadge plate={it.plate} size="sm" />
                                            <QualityTag status={it.quality_status} rating={it.quality_rating} testId={`history-quality-${it.id}`} />
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1 truncate">{it.brand} {it.model} · {it.client_name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Terminado {fmt(it.service_completed_at)} · técnico {it.role}{it.partner_name ? ` con ${it.partner_name}` : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {it.installed_services.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded bg-muted/60">{s}</span>)}
                                </div>
                                <QualityComments reviews={it.quality_reviews} fallbackNotes={it.quality_notes} testId={`history-comments-${it.id}`} />
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <ChargeBadge charge={it.charge} testId={`history-charge-${it.id}`} />
                                    {canCharge && (
                                        <Button size="sm" onClick={() => setCharging(it)} className="ml-auto" data-testid={`charge-btn-${it.id}`}>
                                            <HandCoins className="w-4 h-4 mr-1.5" /> {it.charge ? 'Cobrar de nuevo' : 'Cobrar servicio'}
                                        </Button>
                                    )}
                                </div>
                                {it.charge?.review_notes && it.charge.status !== 'rechazado' && (
                                    <p className="text-xs text-muted-foreground">Liquidaciones: {it.charge.review_notes}</p>
                                )}
                                {it.charge?.status === 'rechazado' && (
                                    <p className="text-xs text-red-300">Rechazado: {it.charge.review_notes}</p>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
            {charging && (
                <ChargeDialog
                    key={charging.id}
                    item={charging}
                    onClose={() => setCharging(null)}
                    onSaved={() => { setCharging(null); onChanged?.(); }}
                />
            )}
        </div>
    );
};

export default TechnicianHistory;
