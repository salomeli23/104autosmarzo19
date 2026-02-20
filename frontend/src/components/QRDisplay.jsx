import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { QrCode, Download, Camera, Timer } from 'lucide-react';

export const QRDisplay = ({ qrCode, orderCode, clientName, onPhotoCapture }) => {
    const [showCamera, setShowCamera] = useState(false);
    const [countdown, setCountdown] = useState(15);
    const [capturing, setCapturing] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    const downloadQR = () => {
        if (!qrCode) return;
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${qrCode}`;
        link.download = `QR_${orderCode}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const startCameraWithTimer = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setShowCamera(true);
            setCountdown(15);
            setCapturing(true);
        } catch (err) {
            console.error('Error accessing camera:', err);
        }
    };

    const capturePhoto = () => {
        if (!videoRef.current) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);
        const photoData = canvas.toDataURL('image/jpeg', 0.8);
        
        stopCamera();
        onPhotoCapture?.(photoData);
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
        setCapturing(false);
    };

    useEffect(() => {
        let timer;
        if (capturing && countdown > 0) {
            timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        } else if (capturing && countdown === 0) {
            capturePhoto();
        }
        return () => clearTimeout(timer);
    }, [countdown, capturing]);

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    if (showCamera) {
        return (
            <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                    <CardTitle className="font-heading text-lg flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <Camera className="w-5 h-5 text-primary" />
                            Capturar Foto del QR
                        </span>
                        <span className="flex items-center gap-2 text-primary">
                            <Timer className="w-5 h-5" />
                            <span className="font-mono text-2xl">{countdown}s</span>
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="relative w-full aspect-video max-w-md mx-auto rounded-lg overflow-hidden bg-black">
                        <video 
                            ref={videoRef}
                            autoPlay 
                            playsInline 
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 border-4 border-primary/50 rounded-lg pointer-events-none" />
                    </div>
                    
                    <div className="flex gap-2 justify-center">
                        <Button onClick={capturePhoto} className="brand-glow">
                            <Camera className="w-4 h-4 mr-2" />
                            Capturar Ahora
                        </Button>
                        <Button variant="outline" onClick={stopCamera}>
                            Cancelar
                        </Button>
                    </div>
                    
                    <p className="text-xs text-muted-foreground text-center">
                        La foto se capturará automáticamente en {countdown} segundos
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="overflow-hidden">
            <CardHeader className="pb-2">
                <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-primary" />
                    Código QR de la Cita
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {qrCode ? (
                    <>
                        <div className="flex flex-col items-center">
                            <div className="bg-white p-4 rounded-lg shadow-lg">
                                <img 
                                    src={`data:image/png;base64,${qrCode}`}
                                    alt="QR Code"
                                    className="w-48 h-48"
                                    data-testid="qr-code-image"
                                />
                            </div>
                            <p className="mt-3 text-center">
                                <span className="text-muted-foreground text-sm">Código:</span>
                                <span className="font-mono font-bold text-lg ml-2 text-primary">{orderCode}</span>
                            </p>
                            {clientName && (
                                <p className="text-sm text-muted-foreground">{clientName}</p>
                            )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 justify-center">
                            <Button onClick={downloadQR} variant="outline" data-testid="download-qr-btn">
                                <Download className="w-4 h-4 mr-2" />
                                Descargar QR
                            </Button>
                            {onPhotoCapture && (
                                <Button onClick={startCameraWithTimer} className="brand-glow" data-testid="capture-qr-photo-btn">
                                    <Camera className="w-4 h-4 mr-2" />
                                    Foto del QR (15s)
                                </Button>
                            )}
                        </div>

                        <p className="text-xs text-muted-foreground text-center">
                            Descarga el QR para compartirlo o usa la cámara para capturar una foto
                        </p>
                    </>
                ) : (
                    <div className="flex flex-col items-center py-8 text-muted-foreground">
                        <QrCode className="w-16 h-16 mb-4 opacity-50" />
                        <p>No hay código QR disponible</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default QRDisplay;
