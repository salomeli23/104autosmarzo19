import React from 'react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { Copy, MessageCircle, X, KeyRound } from 'lucide-react';
import { ROLE_LABELS } from '../lib/utils';

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
 * Accesos recién creados, para copiar o enviar por WhatsApp.
 * accesses: [{ name, role, entry_id?, pin?, email?, password?, note? }]
 */
export const AccessShareCard = ({ accesses, onClose }) => {
    if (!accesses?.length) return null;
    const all = accesses.map(accessText).join('\n\n— — —\n\n');
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
            <p className="text-xs text-muted-foreground">Por seguridad el PIN y la contraseña solo se muestran ahora. Cópialos o envíalos antes de cerrar.</p>
            {accesses.length > 1 && (
                <div className="flex flex-wrap gap-2">
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
                            <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-sm">{a.name}{a.note && <span className="ml-2 text-xs text-cyan-400">{a.note}</span>}</p>
                                <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => copy(text, `Acceso de ${a.name} copiado`)} data-testid={`access-copy-${i}`}>
                                        <Copy className="w-4 h-4 mr-1" /> Copiar
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-emerald-400" onClick={() => whatsapp(text)} data-testid={`access-wa-${i}`}>
                                        <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                                    </Button>
                                </div>
                            </div>
                            <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground select-all">{text}</pre>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AccessShareCard;
