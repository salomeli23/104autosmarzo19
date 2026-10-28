import React, { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { X } from 'lucide-react';

/**
 * Contenedor de cámara a pantalla completa (fotos y video de la Revisión 360°).
 * Usa el Dialog de la app para funcionar también dentro de otros diálogos abiertos.
 * Props: open, onClose(), title, subtitle, children (vista de cámara), bottom (controles), topRight
 */
export const FullscreenCamera = ({ open, onClose, title, subtitle, children, bottom, topRight, testId }) => {
    const contentRef = useRef(null);

    // En Android oculta la barra del navegador; en iOS el contenedor igual cubre toda la pantalla
    useEffect(() => {
        if (!open) return undefined;
        const el = contentRef.current;
        const t = setTimeout(() => {
            try { el?.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* no soportado */ }
        }, 50);
        return () => {
            clearTimeout(t);
            try { if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {}); } catch { /* nada */ }
        };
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
            <DialogContent
                ref={contentRef}
                className="z-[100] left-0 top-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-full h-[100dvh] p-0 gap-0 border-0 rounded-none sm:rounded-none bg-black text-white overflow-hidden [&>button:last-child]:hidden"
                // Sin la animación de deslizar/zoom de los diálogos centrados
                style={{ animation: 'none' }}
                onPointerDownOutside={(e) => e.preventDefault()}
                data-testid={testId}
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <DialogDescription className="sr-only">{subtitle || title}</DialogDescription>

                <div className="absolute inset-0">{children}</div>

                <div className="absolute top-0 inset-x-0 z-10 flex items-start justify-between gap-3 px-4 pb-8 pt-[max(env(safe-area-inset-top),12px)] bg-gradient-to-b from-black/80 to-transparent">
                    <div className="min-w-0">
                        <p className="font-heading text-lg leading-tight">{title}</p>
                        {subtitle && <p className="text-xs text-white/70">{subtitle}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {topRight}
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-11 h-11 rounded-full bg-black/50 border border-white/20 flex items-center justify-center active:scale-95"
                            aria-label="Cerrar cámara"
                            data-testid="fullscreen-camera-close"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                <div className="absolute bottom-0 inset-x-0 z-10 px-4 pt-10 pb-[max(env(safe-area-inset-bottom),16px)] bg-gradient-to-t from-black/85 to-transparent">
                    {bottom}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default FullscreenCamera;
