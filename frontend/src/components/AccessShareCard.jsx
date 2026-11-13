import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { Copy, MessageCircle, X, KeyRound, Smartphone, Loader2, Check } from 'lucide-react';
import { ROLE_LABELS } from '../lib/utils';
import { usersAPI } from '../lib/api';

const appUrl = () => window.location.origin;

/** Texto de acceso de una persona, listo para WhatsApp (*negrita*). */
export const accessText = (a) => {
    if (a.entry_id) {
        return [
            `Hola ${a.name}, este es tu acceso a PolarizadosYA! 🔧`,
            `Entra aquí: ${appUrl()}/login?pin=1`,
            `ID de entrada: *${a.entry_id}*`,
            `PIN: *${a.pin}*`,
            `No compartas tu PIN.`,
        ].join('\n');
    }
    return [
        `Hola ${a.name}, este es tu acceso a PolarizadosYA! (${ROLE_LABELS[a.role] || a.role})`,
        `Entra aquí: ${appUrl()}/login`,
        `Correo: *${a.email}*`,
        `Contraseña: *${a.password}*`,
        `Te recomendamos cambiarla al entrar.`,
    ].join('\n');
};

const copy = async (text, msg) => {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(msg);
    } catch {
        // Sin permiso de portapapeles: copia con un textarea temporal
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        ok ? toast.success(msg) : toast.error('No se pudo copiar; selecciona el texto y cópialo');
    }
};
const whatsapp = (text) => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');

/**
 * Accesos recién creados, para copiar, enviar por WhatsApp o por SMS al celular de cada persona.
 * accesses: [{ user_id?, name, role, entry_id?, pin?, email?, password?, phone?, note? }]
 */
export const AccessShareCard = ({ accesses, onClose }) => {
    const [smsReady, setSmsReady] = useState(null); // null = cargando, {configured, simulated}
    const [phones, setPhones] = useState({});       // celular escrito a mano cuando no hay
    const [sending, setSending] = useState({});     // i → true
    const [sent, setSent] = useState({});           // i → true

    useEffect(() => {
        if (!accesses?.length) return;
        usersAPI.smsStatus().then(res => setSmsReady(res.data)).catch(() => setSmsReady({ configured: false }));
    }, [accesses]);
    useEffect(() => { setPhones({}); setSent({}); }, [accesses]);

    if (!accesses?.length) return null;
    const all = accesses.map(accessText).join('\n\n— — —\n\n');
    const phoneOf = (a, i) => (phones[i] ?? a.phone ?? '').trim();
    const canSms = (a) => !!(smsReady?.configured && a.user_id);

    const sendSms = async (a, i) => {
        const phone = phoneOf(a, i);
        if (!phone) { toast.error(`Escribe el celular de ${a.name}`); return false; }
        setSending(s => ({ ...s, [i]: true }));
        try {
            const { data } = await usersAPI.sendAccessSms(a.user_id, {
                pin: a.entry_id ? a.pin : null, password: a.entry_id ? null : a.password,
                phone, app_url: appUrl(),
            });
            setSent(s => ({ ...s, [i]: true }));
            toast.success(data.simulated ? `${data.message} (simulado)` : data.message);
            return true;
        } catch (e) {
            toast.error(e.response?.data?.detail || `No se pudo enviar el SMS a ${a.name}`);
            return false;
        } finally {
            setSending(s => ({ ...s, [i]: false }));
        }
    };
    const sendAll = async () => {
        let ok = 0;
        for (let i = 0; i < accesses.length; i += 1) {
            const a = accesses[i];
            if (sent[i] || !canSms(a) || !phoneOf(a, i)) continue;
            // eslint-disable-next-line no-await-in-loop
            if (await sendSms(a, i)) ok += 1;
        }
        if (!ok) toast.message('No había accesos con celular por enviar');
    };
    const withPhone = accesses.filter((a, i) => canSms(a) && phoneOf(a, i) && !sent[i]).length;

    return (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-3" data-testid="access-share">
            <div className="flex items-center justify-between gap-2">
                <p className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-emerald-400" /> Accesos para enviar</p>
                {onClose && (
                    <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">Por seguridad el PIN y la contraseña solo se muestran ahora. Envíalos antes de cerrar.</p>
            {smsReady && !smsReady.configured && (
                <p className="text-xs text-amber-400" data-testid="sms-not-configured">
                    El envío por SMS aún no está activo: faltan las claves de LabsMobile en Railway. Mientras tanto usa Copiar o WhatsApp.
                </p>
            )}
            {accesses.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    {smsReady?.configured && (
                        <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700" onClick={sendAll} disabled={!withPhone} data-testid="access-sms-all">
                            <Smartphone className="w-4 h-4 mr-1" /> Enviar SMS a todos ({withPhone})
                        </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => copy(all, `${accesses.length} accesos copiados`)} data-testid="access-copy-all">
                        <Copy className="w-4 h-4 mr-1" /> Copiar todos
                    </Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => whatsapp(all)} data-testid="access-wa-all">
                        <MessageCircle className="w-4 h-4 mr-1" /> Enviar todos por WhatsApp
                    </Button>
                </div>
            )}
            <div className="space-y-2">
                {accesses.map((a, i) => {
                    const text = accessText(a);
                    return (
                        <div key={`${a.name}-${i}`} className="rounded-md border bg-background/60 p-2 space-y-2" data-testid={`access-item-${i}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium text-sm">{a.name}{a.note && <span className="ml-2 text-xs text-cyan-400">{a.note}</span>}</p>
                                <div className="flex flex-wrap gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => copy(text, `Acceso de ${a.name} copiado`)} data-testid={`access-copy-${i}`}>
                                        <Copy className="w-4 h-4 mr-1" /> Copiar
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-emerald-400" onClick={() => whatsapp(text)} data-testid={`access-wa-${i}`}>
                                        <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                                    </Button>
                                </div>
                            </div>
                            {canSms(a) && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input inputMode="tel" value={phones[i] ?? a.phone ?? ''} placeholder="Celular, ej. 3001234567"
                                        onChange={(e) => setPhones(p => ({ ...p, [i]: e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 16) }))}
                                        className="h-8 w-44 font-mono text-sm" data-testid={`access-phone-${i}`} />
                                    <Button size="sm" className="h-8 bg-cyan-600 hover:bg-cyan-700" onClick={() => sendSms(a, i)}
                                        disabled={sending[i] || !phoneOf(a, i)} data-testid={`access-sms-${i}`}>
                                        {sending[i] ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                            : sent[i] ? <Check className="w-4 h-4 mr-1" /> : <Smartphone className="w-4 h-4 mr-1" />}
                                        {sent[i] ? 'SMS enviado · reenviar' : 'Enviar SMS'}
                                    </Button>
                                </div>
                            )}
                            <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground select-all">{text}</pre>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AccessShareCard;
