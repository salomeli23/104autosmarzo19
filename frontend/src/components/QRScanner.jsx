import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Camera, CameraOff, SwitchCamera, Flashlight, FlashlightOff, ImageUp, CheckCircle2, Loader2 } from 'lucide-react';

const CAMERA_KEY = 'qrScanner.cameraId';
const SCANNER_CONFIG = {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
};

const readStoredCamera = () => {
    try { return localStorage.getItem(CAMERA_KEY); } catch { return null; }
};
const storeCamera = (id) => {
    try { localStorage.setItem(CAMERA_KEY, id); } catch { /* sin almacenamiento */ }
};

/** El QR de la cita trae el código de la orden; si trae una URL toma el parámetro o el último segmento. */
export const parseScannedCode = (text) => {
    const raw = (text || '').trim();
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            const param = url.searchParams.get('code') || url.searchParams.get('order') || url.searchParams.get('c');
            const last = url.pathname.split('/').filter(Boolean).pop();
            return (param || last || raw).trim().toUpperCase();
        } catch { /* no es URL válida */ }
    }
    return raw.toUpperCase();
};

const cameraErrorMessage = (err) => {
    const text = `${err?.name || ''} ${err?.message || err || ''}`;
    if (!window.isSecureContext) return 'La cámara solo funciona con conexión segura (https).';
    if (/NotAllowed|Permission/i.test(text)) return 'Permiso de cámara denegado. Actívalo en la configuración del navegador (ícono del candado junto a la dirección) y vuelve a intentar.';
    if (/NotFound|Requested device not found|OverconstrainedError/i.test(text)) return 'No se encontró una cámara en este dispositivo. Usa "Leer desde foto" o ingresa el código.';
    if (/NotReadable|TrackStartError|Could not start/i.test(text)) return 'La cámara está siendo usada por otra aplicación. Ciérrala y vuelve a intentar.';
    return 'No se pudo iniciar la cámara. Usa "Leer desde foto" o ingresa el código.';
};

const playBeep = () => {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1200;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
        osc.onended = () => ctx.close();
    } catch { /* sin audio */ }
};

/**
 * Escáner de QR con la cámara del dispositivo (cámara trasera por defecto).
 * Props: onScan(code), onError(message), autoStart
 */
export const QRScanner = ({ onScan, onError, autoStart = false }) => {
    const idRef = useRef(`qr-reader-${Math.random().toString(36).slice(2, 9)}`);
    const fileReaderIdRef = useRef(`${idRef.current}-file`);
    const scannerRef = useRef(null);
    const runningRef = useRef(false);
    const handledRef = useRef(false);
    const fileInputRef = useRef(null);
    const onScanRef = useRef(onScan);
    onScanRef.current = onScan;

    const [status, setStatus] = useState('idle'); // idle | starting | scanning | done
    const [error, setError] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [cameraId, setCameraId] = useState(readStoredCamera);
    const [torchSupported, setTorchSupported] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [lastCode, setLastCode] = useState(null);
    const [readingFile, setReadingFile] = useState(false);

    const stop = useCallback(async () => {
        const scanner = scannerRef.current;
        if (scanner && runningRef.current) {
            runningRef.current = false;
            try { await scanner.stop(); } catch { /* ya detenido */ }
            try { scanner.clear(); } catch { /* nada que limpiar */ }
        }
        setTorchOn(false);
        setTorchSupported(false);
    }, []);

    const handleDecoded = useCallback(async (text) => {
        if (handledRef.current) return;
        handledRef.current = true;
        const code = parseScannedCode(text);
        try { navigator.vibrate?.(150); } catch { /* sin vibración */ }
        playBeep();
        await stop();
        setLastCode(code);
        setStatus('done');
        onScanRef.current?.(code);
    }, [stop]);

    const start = useCallback(async (preferredId) => {
        setError(null);
        handledRef.current = false;
        await stop();
        setStatus('starting');
        if (!navigator.mediaDevices?.getUserMedia) {
            const msg = cameraErrorMessage({ name: 'NotFoundError' });
            setError(msg);
            setStatus('idle');
            onError?.(msg);
            return;
        }
        if (!scannerRef.current) scannerRef.current = new Html5Qrcode(idRef.current, SCANNER_CONFIG);
        const config = {
            fps: 15,
            aspectRatio: 1,
            qrbox: (w, h) => {
                const size = Math.floor(Math.min(w, h) * 0.75);
                return { width: size, height: size };
            },
        };
        const tryStart = (source) => scannerRef.current.start(source, config, handleDecoded, () => {});
        const targetId = preferredId === undefined ? cameraId : preferredId;
        try {
            try {
                await tryStart(targetId ? { deviceId: { exact: targetId } } : { facingMode: 'environment' });
            } catch (err) {
                // La cámara guardada pudo desaparecer: reintenta con la trasera
                if (!targetId) throw err;
                await tryStart({ facingMode: 'environment' });
            }
            runningRef.current = true;
            setStatus('scanning');
            try {
                setTorchSupported(scannerRef.current.getRunningTrackCameraCapabilities().torchFeature().isSupported());
            } catch { setTorchSupported(false); }
            Html5Qrcode.getCameras().then(list => setCameras(list || [])).catch(() => {});
        } catch (err) {
            const msg = cameraErrorMessage(err);
            setError(msg);
            setStatus('idle');
            onError?.(msg);
        }
    }, [cameraId, handleDecoded, onError, stop]);

    const switchCamera = async () => {
        if (cameras.length < 2) return;
        let currentId = cameraId;
        try { currentId = scannerRef.current?.getRunningTrackSettings()?.deviceId || cameraId; } catch { /* sin datos */ }
        const idx = cameras.findIndex(c => c.id === currentId);
        const next = cameras[(idx + 1) % cameras.length];
        setCameraId(next.id);
        storeCamera(next.id);
        await start(next.id);
    };

    const toggleTorch = async () => {
        try {
            const torch = scannerRef.current.getRunningTrackCameraCapabilities().torchFeature();
            await torch.apply(!torchOn);
            setTorchOn(!torchOn);
        } catch {
            setTorchSupported(false);
        }
    };

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError(null);
        setReadingFile(true);
        await stop();
        try {
            const fileScanner = new Html5Qrcode(fileReaderIdRef.current, SCANNER_CONFIG);
            const text = await fileScanner.scanFile(file, false);
            try { fileScanner.clear(); } catch { /* nada que limpiar */ }
            handledRef.current = false;
            await handleDecoded(text);
        } catch {
            setError('No se encontró un código QR en la foto. Toma la foto más cerca y con buena luz.');
            setStatus('idle');
        } finally {
            setReadingFile(false);
        }
    };

    useEffect(() => {
        if (autoStart) start();
        return () => {
            const scanner = scannerRef.current;
            if (scanner && runningRef.current) {
                runningRef.current = false;
                scanner.stop().then(() => scanner.clear()).catch(() => {});
            }
        };
        // Solo al montar: start depende de estado que cambia mientras escanea
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const scanning = status === 'scanning';

    return (
        <Card className="overflow-hidden" data-testid="qr-scanner">
            <CardHeader className="pb-2">
                <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <Camera className="w-5 h-5 text-primary" />
                    Escanear QR de la cita
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="relative w-full max-w-sm mx-auto aspect-square rounded-lg overflow-hidden bg-muted">
                    {/* El lector controla este div: no poner hijos de React adentro */}
                    <div id={idRef.current} className="w-full h-full [&_video]:object-cover [&_video]:!w-full [&_video]:!h-full" />
                    {!scanning && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                            {status === 'starting' ? (
                                <>
                                    <Loader2 className="w-12 h-12 mb-3 animate-spin" />
                                    <p className="text-sm">Abriendo la cámara…</p>
                                </>
                            ) : status === 'done' ? (
                                <>
                                    <CheckCircle2 className="w-14 h-14 mb-3 text-emerald-500" />
                                    <p className="text-sm">Código leído</p>
                                    <p className="font-mono text-xl font-bold text-foreground" data-testid="qr-last-code">{lastCode}</p>
                                </>
                            ) : (
                                <>
                                    <Camera className="w-16 h-16 mb-4 opacity-50" />
                                    <p className="text-sm">Presiona "Iniciar cámara" y apunta al QR de la cita</p>
                                </>
                            )}
                        </div>
                    )}
                    {scanning && (
                        <div className="absolute top-2 inset-x-2 flex justify-between pointer-events-none">
                            <span className="text-[11px] px-2 py-1 rounded-full bg-black/60 text-white">Buscando QR…</span>
                        </div>
                    )}
                </div>
                <div id={fileReaderIdRef.current} className="hidden" />

                {error && (
                    <div className="p-3 rounded-lg bg-destructive/20 text-destructive text-sm text-center" data-testid="qr-scanner-error">
                        {error}
                    </div>
                )}

                <div className="flex flex-wrap gap-2 justify-center">
                    {scanning ? (
                        <>
                            <Button variant="outline" onClick={() => { stop(); setStatus('idle'); }} data-testid="stop-scanner-btn">
                                <CameraOff className="w-4 h-4 mr-2" />
                                Detener
                            </Button>
                            {cameras.length > 1 && (
                                <Button variant="secondary" onClick={switchCamera} data-testid="switch-camera-btn">
                                    <SwitchCamera className="w-4 h-4 mr-2" />
                                    Cambiar cámara
                                </Button>
                            )}
                            {torchSupported && (
                                <Button variant="secondary" onClick={toggleTorch} data-testid="torch-btn">
                                    {torchOn ? <FlashlightOff className="w-4 h-4 mr-2" /> : <Flashlight className="w-4 h-4 mr-2" />}
                                    {torchOn ? 'Apagar luz' : 'Linterna'}
                                </Button>
                            )}
                        </>
                    ) : (
                        <Button onClick={() => start()} className="brand-glow" disabled={status === 'starting' || readingFile} data-testid="start-scanner-btn">
                            <Camera className="w-4 h-4 mr-2" />
                            {status === 'done' ? 'Escanear otra vez' : 'Iniciar cámara'}
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={readingFile} data-testid="scan-photo-btn">
                        {readingFile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImageUp className="w-4 h-4 mr-2" />}
                        Leer desde foto
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleFile}
                        data-testid="scan-photo-input"
                    />
                </div>

                <p className="text-xs text-muted-foreground text-center">
                    Apunta la cámara al QR que el cliente recibió al agendar. Si la cámara no abre, usa "Leer desde foto".
                </p>
            </CardContent>
        </Card>
    );
};

export default QRScanner;
