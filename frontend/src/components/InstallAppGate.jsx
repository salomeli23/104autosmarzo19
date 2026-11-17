import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Download, Share, PlusSquare, MoreVertical, Smartphone, LogOut, CheckCircle } from 'lucide-react';

const LOGO = '/icon-192.png';
const INSTALLED_KEY = 'pya_app_installed';

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isPhone = () => window.matchMedia?.('(max-width: 900px)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
const ua = () => navigator.userAgent || '';
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOSSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua());
const readFlag = () => { try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch { return false; } };
const writeFlag = () => { try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* sin almacenamiento */ } };

/** ¿Se debe pedir instalar la app? Solo técnicos, en celular, fuera de la app instalada y la primera vez. */
export const mustInstallApp = (user) => user?.role === 'tecnico' && isPhone() && !isStandalone() && !readFlag();

const Step = ({ n, icon: Icon, children }) => (
    <li className="flex items-start gap-3 text-left">
        <span className="shrink-0 w-7 h-7 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">{n}</span>
        <span className="text-sm leading-snug pt-1">{children}{Icon && <Icon className="inline w-4 h-4 mx-1 -mt-0.5" />}</span>
    </li>
);

/**
 * Pantalla completa que pide instalar la app a los técnicos en el celular la primera vez.
 * Android/Chrome: botón "Instalar app". iPhone: pasos de Safari (Compartir → Agregar a inicio).
 */
export const InstallAppGate = ({ user, onLogout }) => {
    const [show, setShow] = useState(() => mustInstallApp(user));
    const [prompt, setPrompt] = useState(() => window.__pwaPrompt);
    const [installed, setInstalled] = useState(false);

    useEffect(() => {
        setShow(mustInstallApp(user));
    }, [user]);
    useEffect(() => {
        const onReady = () => setPrompt(window.__pwaPrompt);
        const onInstalled = () => { writeFlag(); setInstalled(true); };
        window.addEventListener('pwa-prompt-ready', onReady);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('pwa-prompt-ready', onReady);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (!show) return null;

    const install = async () => {
        if (!prompt) return;
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        window.__pwaPrompt = null;
        setPrompt(null);
        if (choice?.outcome === 'accepted') { writeFlag(); setInstalled(true); }
    };
    const done = () => { writeFlag(); setShow(false); };

    let body;
    if (installed) {
        body = (
            <div className="space-y-4">
                <CheckCircle className="w-14 h-14 text-emerald-400 mx-auto" />
                <p className="text-lg font-semibold">¡App instalada!</p>
                <p className="text-sm text-muted-foreground">Ciérrala aquí y ábrela desde el ícono <b>PolarizadosYA</b> de tu pantalla de inicio.</p>
                <Button variant="outline" className="w-full" onClick={done} data-testid="install-continue">Continuar aquí por ahora</Button>
            </div>
        );
    } else if (prompt) {
        body = (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Instala la app en tu celular para recibir tus servicios más rápido y entrar con tu ID y PIN.</p>
                <Button className="w-full h-14 text-lg brand-glow" onClick={install} data-testid="install-app-btn">
                    <Download className="w-5 h-5 mr-2" /> Instalar app
                </Button>
            </div>
        );
    } else if (isIOS() && !isIOSSafari()) {
        body = (
            <ol className="space-y-3">
                <Step n={1}>Copia la dirección <b>polarizados.space</b></Step>
                <Step n={2}>Ábrela en <b>Safari</b> (en iPhone solo Safari puede instalar apps web)</Step>
                <Step n={3}>Sigue los pasos que aparecen ahí</Step>
            </ol>
        );
    } else if (isIOS()) {
        body = (
            <ol className="space-y-3">
                <Step n={1} icon={Share}>Toca el botón <b>Compartir</b></Step>
                <Step n={2} icon={PlusSquare}>Elige <b>Agregar a inicio</b> (desliza hacia abajo si no lo ves)</Step>
                <Step n={3}>Toca <b>Agregar</b> y abre la app desde el ícono <b>PolarizadosYA</b></Step>
            </ol>
        );
    } else {
        body = (
            <ol className="space-y-3">
                <Step n={1} icon={MoreVertical}>Toca el menú del navegador</Step>
                <Step n={2}>Elige <b>Instalar app</b> o <b>Agregar a pantalla principal</b></Step>
                <Step n={3}>Abre la app desde el ícono <b>PolarizadosYA</b></Step>
            </ol>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
            data-testid="install-app-gate">
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center max-w-sm mx-auto w-full gap-6">
                <img src={LOGO} alt="PolarizadosYA" className="w-24 h-24 rounded-2xl shadow-lg" />
                <div className="space-y-1">
                    <h1 className="font-heading text-2xl flex items-center justify-center gap-2"><Smartphone className="w-6 h-6" /> Instala la app</h1>
                    <p className="text-sm text-muted-foreground">Hola {user?.name?.split(' ')[0]}, antes de empezar instala PolarizadosYA en tu celular.</p>
                </div>
                <div className="w-full">{body}</div>
                {!installed && (
                    <div className="w-full space-y-2 pt-2">
                        <Button variant="ghost" className="w-full text-muted-foreground" onClick={done} data-testid="install-already">
                            Ya la instalé
                        </Button>
                        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onLogout}>
                            <LogOut className="w-4 h-4 mr-1" /> Cerrar sesión
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default InstallAppGate;
