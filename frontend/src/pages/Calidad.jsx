import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { qualityAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { CameraCapture } from '../components/CameraCapture';
import { VideoCapture } from '../components/VideoCapture';
import { cn, formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import {
    BadgeCheck, AlertTriangle, Loader2, Clock, RefreshCw, Undo2, Camera, Video, ClipboardCheck, Wrench,
} from 'lucide-react';

const MIN_PHOTOS = 2;

const RESULTS = [
    { value: 'ok', label: 'Cumple', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60' },
    { value: 'no_ok', label: 'No cumple', className: 'bg-red-500/20 text-red-300 border-red-500/60' },
    { value: 'na', label: 'N/A', className: 'bg-muted text-foreground border-border' },
];

const minutesSince = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

const formatWait = (mins) => {
    if (mins === null) return '-';
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
};

/** Alerta de pago: el cliente no ha pagado o tiene saldo pendiente */
export const UnpaidAlert = ({ order, className }) => {
    if (!order || order.balance <= 0.01) return null;
    const partial = order.payment_status === 'partial';
    return (
        <div
            className={cn('flex items-start gap-2 p-3 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-sm', className)}
            data-testid={`unpaid-alert-${order.id}`}
        >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
                <p className="font-semibold">{partial ? 'El cliente tiene pago parcial' : 'El cliente no ha pagado'}</p>
                <p className="text-xs">
                    Saldo pendiente {formatCurrency(order.balance)} de {formatCurrency(order.total)}.
                    {' '}No se podrá generar el certificado de salida hasta que pague.
                </p>
            </div>
        </div>
    );
};

const serviceName = (s) => (typeof s === 'object' ? (s.description || s.service) : s);

const QualityCard = ({ order, onReview }) => {
    const waited = minutesSince(order.quality_sent_at || order.service_completed_at);
    const techs = [order.assigned_technician_name, order.assigned_technician_2_name].filter(Boolean).join(' · ');
    return (
        <Card className={cn('card-hover', order.balance > 0.01 ? 'border-red-500/40' : 'border-violet-500/40')} data-testid={`quality-card-${order.id}`}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <CarAvatar photoUrl={order.profile_photo_url} size={44} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={order.plate} size="md" />
                                {order.quality_rejections > 0 && (
                                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">
                                        <Undo2 className="w-3 h-3 mr-1" /> Corregido · revisión {order.quality_rejections + 1}
                                    </Badge>
                                )}
                                {order.balance > 0.01 ? (
                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/40" data-testid={`unpaid-badge-${order.id}`}>
                                        <AlertTriangle className="w-3 h-3 mr-1" /> {order.payment_status === 'partial' ? 'Pago parcial' : 'No ha pagado'}
                                    </Badge>
                                ) : (
                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40">Pagado</Badge>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                                {order.brand} {order.model} · {order.client_name}
                            </p>
                        </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                        <Clock className="w-3 h-3 mr-1" /> Esperando {formatWait(waited)}
                    </Badge>
                </div>

                <div className="flex flex-wrap gap-1">
                    {order.services.map((s, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded bg-muted/60">{serviceName(s)}</span>
                    ))}
                </div>
                {techs && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Wrench className="w-3 h-3" /> Instalado por {techs}
                    </p>
                )}

                <UnpaidAlert order={order} />

                <Button className="w-full" onClick={() => onReview(order)} data-testid={`quality-review-btn-${order.id}`}>
                    <ClipboardCheck className="w-4 h-4 mr-2" /> Revisar calidad
                </Button>
            </CardContent>
        </Card>
    );
};

const QualityReviewDialog = ({ order, onClose, onDone }) => {
    const [answers, setAnswers] = useState({});
    const [photos, setPhotos] = useState([]);
    const [video, setVideo] = useState(null);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(null); // 'approve' | 'reject'

    const items = useMemo(() => (order?.sections || []).flatMap(s => s.items), [order]);
    const answered = items.filter(i => answers[i.id]?.result).length;
    const failed = items.filter(i => answers[i.id]?.result === 'no_ok');
    const complete = items.length > 0 && answered === items.length;

    const setResult = (id, result) => setAnswers(a => ({ ...a, [id]: { ...a[id], result } }));
    const setNote = (id, note) => setAnswers(a => ({ ...a, [id]: { ...a[id], note } }));
    const markAllOk = (section) => setAnswers(a => {
        const next = { ...a };
        section.items.forEach(i => { if (!next[i.id]?.result) next[i.id] = { ...next[i.id], result: 'ok' }; });
        return next;
    });

    const close = () => {
        if (video?.url) URL.revokeObjectURL(video.url);
        onClose();
    };

    const approveBlockers = [
        !complete && `Responde las ${items.length - answered} preguntas pendientes`,
        failed.length > 0 && 'Hay puntos que no cumplen',
        photos.length < MIN_PHOTOS && `Toma al menos ${MIN_PHOTOS} fotos`,
        !video && 'Graba el video de calidad',
    ].filter(Boolean);

    const submit = async (approved) => {
        if (!complete) { toast.error('Responde todas las preguntas del cuestionario'); return; }
        if (!approved && failed.length === 0 && !notes.trim()) {
            toast.error('Marca qué no cumple o escribe qué debe corregir el técnico');
            return;
        }
        setSaving(approved ? 'approve' : 'reject');
        try {
            if (video?.blob) await qualityAPI.uploadVideo(order.id, video.blob);
            const { data } = await qualityAPI.submit(order.id, {
                approved,
                answers: items.map(i => ({ id: i.id, result: answers[i.id].result, note: answers[i.id].note || null })),
                photos,
                notes: notes.trim() || null,
            });
            if (approved) {
                toast.success(data.paid
                    ? 'Calidad aprobada · listo para entrega'
                    : `Calidad aprobada · listo para entrega, pero el cliente debe ${formatCurrency(data.balance)}`);
            } else {
                toast.success('Vehículo devuelto a instalación');
            }
            if (video?.url) URL.revokeObjectURL(video.url);
            onDone();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al guardar el control de calidad');
        } finally {
            setSaving(null);
        }
    };

    if (!order) return null;
    return (
        <Dialog open={!!order} onOpenChange={(v) => !v && close()}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="quality-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-2xl flex items-center gap-2">
                        <BadgeCheck className="w-6 h-6 text-violet-400" /> Control de calidad
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2 flex-wrap">
                        <PlateBadge plate={order.plate} size="sm" /> {order.brand} {order.model} · {order.client_name}
                    </DialogDescription>
                </DialogHeader>

                <UnpaidAlert order={order} />

                {order.service_completion_notes && (
                    <p className="text-xs p-2 rounded bg-muted/50"><b>Nota del técnico:</b> {order.service_completion_notes}</p>
                )}

                <div className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Cuestionario</span>
                        <span className={cn('text-xs', complete ? 'text-emerald-400' : 'text-muted-foreground')} data-testid="quality-progress">
                            {answered}/{items.length} respondidas
                        </span>
                    </div>
                    {order.sections.map(section => (
                        <div key={section.id} className="rounded-lg border border-border p-3 space-y-2" data-testid={`quality-section-${section.id}`}>
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-violet-300">{section.label}</p>
                                <button
                                    type="button"
                                    onClick={() => markAllOk(section)}
                                    className="text-[11px] text-muted-foreground hover:text-emerald-400"
                                    data-testid={`quality-all-ok-${section.id}`}
                                >
                                    Marcar pendientes como Cumple
                                </button>
                            </div>
                            {section.items.map(item => {
                                const ans = answers[item.id] || {};
                                return (
                                    <div key={item.id} className="space-y-1.5 py-1.5 border-t border-border/50 first:border-t-0">
                                        <p className="text-sm">{item.label}</p>
                                        <div className="flex gap-1.5">
                                            {RESULTS.map(r => (
                                                <button
                                                    key={r.value}
                                                    type="button"
                                                    onClick={() => setResult(item.id, r.value)}
                                                    className={cn(
                                                        'flex-1 h-9 rounded-md border text-xs font-medium transition-colors',
                                                        ans.result === r.value ? r.className : 'border-input text-muted-foreground hover:bg-muted/50',
                                                    )}
                                                    data-testid={`q-${item.id}-${r.value}`}
                                                >
                                                    {r.label}
                                                </button>
                                            ))}
                                        </div>
                                        {ans.result === 'no_ok' && (
                                            <Input
                                                value={ans.note || ''}
                                                onChange={(e) => setNote(item.id, e.target.value)}
                                                placeholder="¿Qué debe corregir el técnico?"
                                                className="h-8 text-xs"
                                                data-testid={`q-${item.id}-note`}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}

                    <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                            <Camera className="w-4 h-4" /> Fotos del vehículo terminado (mínimo {MIN_PHOTOS})
                        </Label>
                        <CameraCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={10} />
                    </div>

                    <div className="space-y-2">
                        <Label className="flex items-center gap-2"><Video className="w-4 h-4" /> Video de calidad (20 s)</Label>
                        <VideoCapture video={video} onVideoChange={setVideo} durationSeconds={20} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="quality-notes">Observaciones</Label>
                        <Textarea
                            id="quality-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Observaciones generales de la revisión"
                            rows={2}
                            data-testid="quality-notes"
                        />
                    </div>

                    {approveBlockers.length > 0 && (
                        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5" data-testid="quality-blockers">
                            {approveBlockers.map(b => <li key={b}>{b}</li>)}
                        </ul>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <Button
                            variant="outline"
                            className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            onClick={() => submit(false)}
                            disabled={!!saving || !complete}
                            data-testid="quality-reject-btn"
                        >
                            {saving === 'reject' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Undo2 className="w-4 h-4 mr-2" />}
                            Devolver a instalación
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={() => submit(true)}
                            disabled={!!saving || approveBlockers.length > 0}
                            data-testid="quality-approve-btn"
                        >
                            {saving === 'approve' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BadgeCheck className="w-4 h-4 mr-2" />}
                            Aprobar calidad
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const Calidad = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reviewing, setReviewing] = useState(null);

    const load = useCallback(async () => {
        try {
            const { data } = await qualityAPI.pending();
            setOrders(data);
        } catch (e) {
            toast.error('Error al cargar los vehículos de control de calidad');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const unpaid = orders.filter(o => o.balance > 0.01).length;

    return (
        <div className="space-y-6" data-testid="calidad-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Control de Calidad</h1>
                    <p className="text-muted-foreground">
                        Vehículos con la instalación terminada. Responde el cuestionario, toma fotos y graba el video antes de pasar a entrega.
                    </p>
                </div>
                <Button variant="outline" onClick={load} data-testid="quality-refresh">
                    <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
                </Button>
            </div>

            {!loading && orders.length > 0 && (
                <div className="flex gap-2 flex-wrap text-sm">
                    <Badge variant="outline">{orders.length} por revisar</Badge>
                    {unpaid > 0 && (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/40">
                            <AlertTriangle className="w-3 h-3 mr-1" /> {unpaid} sin pago completo
                        </Badge>
                    )}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : orders.length === 0 ? (
                <Card><CardContent className="p-10 text-center text-muted-foreground">
                    <BadgeCheck className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    No hay vehículos esperando control de calidad.
                </CardContent></Card>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {orders.map(o => <QualityCard key={o.id} order={o} onReview={setReviewing} />)}
                </div>
            )}

            {reviewing && (
                <QualityReviewDialog
                    key={reviewing.id}
                    order={reviewing}
                    onClose={() => setReviewing(null)}
                    onDone={() => { setReviewing(null); load(); }}
                />
            )}
        </div>
    );
};

export default Calidad;
