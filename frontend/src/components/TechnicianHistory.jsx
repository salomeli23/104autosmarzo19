import React, { useEffect, useMemo, useState } from 'react';
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

export const ChargeBadge = ({ charge, testId, noun }) => {
    if (!charge) return null;
    const meta = CHARGE_META[charge.status] || CHARGE_META.pendiente;
    const Icon = meta.icon;
    const label = noun ? meta.label.replace('Cobro', noun) : meta.label;
    const amount = charge.status === 'aprobado' || charge.status === 'pagado' ? charge.approved_amount : charge.amount;
    return (
        <Badge className={`gap-1 ${meta.className}`} data-testid={testId}>
            <Icon className="w-3 h-3" /> {label} · {formatCurrency(amount)}
        </Badge>
    );
};

const digits = (v) => String(v || '').replace(/\D/g, '');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '-');

const REMOVALS = [
    { id: 'completo', label: 'Carro completo' },
    { id: 'laterales', label: 'Laterales' },
    { id: 'panoramico', label: 'Panorámico' },
];

const ChargeDialog = ({ item, onClose, onSaved }) => {
    const [vehicleType, setVehicleType] = useState('automovil');
    const [teslaRoof, setTeslaRoof] = useState('');
    const [removals, setRemovals] = useState([]);
    // Lo que instaló este técnico: { pieces: {índice: [vidrios]}, services: [índices] } (null = aún sin cargar)
    const [selection, setSelection] = useState(null);
    const [quote, setQuote] = useState(null);
    const [quoting, setQuoting] = useState(true);
    const [other, setOther] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const otherValue = Number(digits(other) || 0);

    const options = useMemo(() => ({
        vehicle_type: vehicleType,
        tesla_roof: teslaRoof || null,
        removals,
        pieces: selection?.pieces ?? null,
        services: selection?.services ?? null,
    }), [vehicleType, teslaRoof, removals, selection]);

    // Valor según la tabla de pago a instaladores
    useEffect(() => {
        let alive = true;
        setQuoting(true);
        technicianChargesAPI.quote({ order_id: item.id, ...options })
            .then(({ data }) => {
                if (!alive) return;
                setQuote(data);
                // Primera vez: marcar todo lo instalado que el otro técnico no haya cobrado
                if (!selection) {
                    const taken = data.taken || {};
                    const pieces = {};
                    const services = [];
                    (data.units || []).forEach(u => {
                        if (u.kind === 'polarizado') pieces[u.index] = u.pieces.map(p => p.id).filter(p => !taken[`${u.index}:${p}`]);
                        else if (!taken[String(u.index)]) services.push(u.index);
                    });
                    setSelection({ pieces, services });
                }
            })
            .catch((e) => alive && toast.error(e.response?.data?.detail || 'No se pudo calcular la tarifa'))
            .finally(() => alive && setQuoting(false));
        return () => { alive = false; };
    }, [item.id, options]);

    const withoutRate = quote?.without_rate || [];
    const total = (quote?.total || 0) + (withoutRate.length ? otherValue : 0);
    const needsNote = withoutRate.length > 0 && otherValue > 0 && !notes.trim();

    const toggleRemoval = (id) => setRemovals(r => (r.includes(id) ? r.filter(x => x !== id) : [...r, id]));
    const taken = quote?.taken || {};
    const togglePiece = (idx, piece) => setSelection(sel => {
        const cur = sel.pieces[idx] || [];
        return { ...sel, pieces: { ...sel.pieces, [idx]: cur.includes(piece) ? cur.filter(p => p !== piece) : [...cur, piece] } };
    });
    const toggleService = (idx) => setSelection(sel => ({
        ...sel, services: sel.services.includes(idx) ? sel.services.filter(i => i !== idx) : [...sel.services, idx],
    }));
    const takenNote = (key) => (taken[key] ? ` · cobró ${taken[key]}` : '');

    const save = async () => {
        if (total <= 0) { toast.error('Este servicio no tiene tarifa: escribe el valor y explica en la nota'); return; }
        if (needsNote) { toast.error('Explica en la nota el valor de los servicios sin tarifa'); return; }
        setSaving(true);
        try {
            await technicianChargesAPI.create({
                order_id: item.id, ...options,
                other_amount: withoutRate.length ? otherValue : null,
                notes: notes.trim() || null,
            });
            toast.success('Cobro enviado al coordinador de liquidaciones');
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar el cobro');
        } finally {
            setSaving(false);
        }
    };

    const chip = (active) => `px-3 py-1.5 rounded-md border text-sm ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'}`;

    return (
        <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto" data-testid="charge-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-emerald-400" /> Cobrar servicio</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 flex-wrap">
                        <PlateBadge plate={item.plate} size="sm" /> {item.brand} {item.model}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {item.charge?.status === 'rechazado' && (
                        <p className="text-xs p-2 rounded border border-red-500/40 bg-red-500/10 text-red-300">
                            Cobro anterior rechazado: {item.charge.review_notes}
                        </p>
                    )}
                    <div className="space-y-2">
                        <Label>Tipo de vehículo</Label>
                        <div className="flex gap-2">
                            {[['automovil', 'Automóvil'], ['camioneta', 'Camioneta']].map(([v, l]) => (
                                <button key={v} type="button" className={chip(vehicleType === v)} onClick={() => setVehicleType(v)} data-testid={`charge-vehicle-${v}`}>{l}</button>
                            ))}
                        </div>
                    </div>
                    {selection && quote?.units?.length > 0 && (
                        <div className="space-y-2" data-testid="charge-units">
                            <Label>¿Qué instalaste tú?</Label>
                            {quote.units.map(u => (
                                <div key={u.index} className="rounded-lg border border-border p-2 space-y-1.5">
                                    {u.kind === 'polarizado' ? (
                                        <>
                                            <p className="text-sm font-medium">{u.name}</p>
                                            <div className="flex gap-1.5 flex-wrap">
                                                {u.pieces.map(p => {
                                                    const key = `${u.index}:${p.id}`;
                                                    const active = (selection.pieces[u.index] || []).includes(p.id);
                                                    return (
                                                        <button key={p.id} type="button" disabled={!!taken[key]}
                                                            className={`${chip(active)} text-xs disabled:opacity-40 disabled:cursor-not-allowed`}
                                                            onClick={() => togglePiece(u.index, p.id)} data-testid={`charge-piece-${u.index}-${p.id}`}>
                                                            {p.name}{takenNote(key)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    ) : (
                                        <label className={`flex items-center gap-2 text-sm ${taken[String(u.index)] ? 'opacity-40' : 'cursor-pointer'}`}>
                                            <input type="checkbox" className="w-4 h-4" disabled={!!taken[String(u.index)]}
                                                checked={selection.services.includes(u.index)} onChange={() => toggleService(u.index)}
                                                data-testid={`charge-service-${u.index}`} />
                                            {u.name}{takenNote(String(u.index))}
                                        </label>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {quote?.is_tesla && (
                        <div className="space-y-2">
                            <Label>Techo Tesla</Label>
                            <div className="flex gap-2 flex-wrap">
                                {[['', 'Sin techo'], ['medio', 'Medio sunroof'], ['completo', 'Techo sunroof']].map(([v, l]) => (
                                    <button key={v || 'none'} type="button" disabled={!!v && !!taken.techo}
                                        className={`${chip(teslaRoof === v)} disabled:opacity-40 disabled:cursor-not-allowed`}
                                        onClick={() => setTeslaRoof(v)} data-testid={`charge-roof-${v || 'none'}`}>{l}</button>
                                ))}
                                {taken.techo && <span className="text-xs text-muted-foreground self-center">El techo lo cobró {taken.techo}</span>}
                            </div>
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Retiraste película</Label>
                        <div className="flex gap-2 flex-wrap">
                            {REMOVALS.map(r => (
                                <button key={r.id} type="button" disabled={!!taken[`retirada:${r.id}`]}
                                    className={`${chip(removals.includes(r.id))} disabled:opacity-40 disabled:cursor-not-allowed`}
                                    onClick={() => toggleRemoval(r.id)} data-testid={`charge-removal-${r.id}`}>{r.label}{takenNote(`retirada:${r.id}`)}</button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-border p-3 space-y-1 text-sm" data-testid="charge-breakdown">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Tarifa de pago a instaladores</p>
                        {quoting && !quote ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                {(quote?.lines || []).map((l, i) => (
                                    <div key={i} className="flex justify-between gap-3">
                                        <span>{l.concept}</span><span className="font-mono whitespace-nowrap">{formatCurrency(l.amount)}</span>
                                    </div>
                                ))}
                                {!quote?.lines?.length && <p className="text-muted-foreground text-xs">Ningún servicio instalado tiene tarifa en la tabla.</p>}
                            </>
                        )}
                    </div>

                    {withoutRate.length > 0 && (
                        <div className="space-y-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
                            <p className="text-xs text-amber-300">Sin tarifa en la tabla: {withoutRate.join(', ')}</p>
                            <Label htmlFor="charge-other">Valor de estos servicios</Label>
                            <Input id="charge-other" inputMode="numeric" className="font-mono"
                                value={otherValue ? `$ ${otherValue.toLocaleString('es-CO')}` : ''}
                                onChange={(e) => setOther(digits(e.target.value))} placeholder="$ 0" data-testid="charge-other" />
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="charge-notes">Nota {withoutRate.length > 0 && otherValue > 0 ? '*' : '(opcional)'}</Label>
                        <Textarea id="charge-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                            placeholder="Ej.: incluye desmonte de película anterior" data-testid="charge-notes" />
                    </div>

                    <div className="flex items-center justify-between font-bold text-lg border-t border-border pt-2">
                        <span>Total a cobrar</span>
                        <span className="font-mono text-emerald-400" data-testid="charge-total">{formatCurrency(total)}</span>
                    </div>
                    {item.partner_name && (
                        <p className="text-xs text-muted-foreground">Instalaste con {item.partner_name}: cobra solo lo que hiciste tú; lo que él ya cobró aparece bloqueado.</p>
                    )}
                    <Button className="w-full" onClick={save} disabled={saving || quoting || total <= 0 || needsNote} data-testid="charge-submit">
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
