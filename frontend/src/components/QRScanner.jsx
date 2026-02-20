import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Camera, CameraOff, RotateCcw } from 'lucide-react';

export const QRScanner = ({ onScan, onError }) => {
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState(null);
    const scannerRef = useRef(null);
    const html5QrCodeRef = useRef(null);

    const startScanning = async () => {
        setError(null);
        try {
            if (!html5QrCodeRef.current) {
                html5QrCodeRef.current = new Html5Qrcode('qr-reader');
            }

            await html5QrCodeRef.current.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                },
                (decodedText) => {
                    stopScanning();
                    onScan?.(decodedText);
                },
                (errorMessage) => {
                    // Ignore frequent errors during scanning
                }
            );
            setScanning(true);
        } catch (err) {
            console.error('Error starting scanner:', err);
            setError('No se pudo acceder a la cámara. Verifica los permisos.');
            onError?.(err.message);
        }
    };

    const stopScanning = async () => {
        try {
            if (html5QrCodeRef.current && scanning) {
                await html5QrCodeRef.current.stop();
                setScanning(false);
            }
        } catch (err) {
            console.error('Error stopping scanner:', err);
        }
    };

    useEffect(() => {
        return () => {
            if (html5QrCodeRef.current) {
                html5QrCodeRef.current.stop().catch(() => {});
            }
        };
    }, []);

    return (
        <Card className="overflow-hidden">
            <CardHeader className="pb-2">
                <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <Camera className="w-5 h-5 text-primary" />
                    Escanear Código QR
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div 
                    id="qr-reader" 
                    ref={scannerRef}
                    className="relative w-full aspect-square max-w-sm mx-auto rounded-lg overflow-hidden bg-muted"
                    style={{ minHeight: '280px' }}
                >
                    {!scanning && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                            <Camera className="w-16 h-16 mb-4 opacity-50" />
                            <p className="text-sm text-center px-4">
                                Presiona el botón para iniciar la cámara
                            </p>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="p-3 rounded-lg bg-destructive/20 text-destructive text-sm text-center">
                        {error}
                    </div>
                )}

                <div className="flex gap-2 justify-center">
                    {!scanning ? (
                        <Button 
                            onClick={startScanning} 
                            className="brand-glow"
                            data-testid="start-scanner-btn"
                        >
                            <Camera className="w-4 h-4 mr-2" />
                            Iniciar Cámara
                        </Button>
                    ) : (
                        <>
                            <Button 
                                variant="outline" 
                                onClick={stopScanning}
                                data-testid="stop-scanner-btn"
                            >
                                <CameraOff className="w-4 h-4 mr-2" />
                                Detener
                            </Button>
                            <Button 
                                variant="secondary" 
                                onClick={() => { stopScanning(); startScanning(); }}
                            >
                                <RotateCcw className="w-4 h-4 mr-2" />
                                Reiniciar
                            </Button>
                        </>
                    )}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                    Apunta la cámara al código QR de la cita
                </p>
            </CardContent>
        </Card>
    );
};

export default QRScanner;
