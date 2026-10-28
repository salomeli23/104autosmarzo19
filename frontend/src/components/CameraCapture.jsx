import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { FullscreenCamera } from './FullscreenCamera';
import { Camera, X, RotateCcw, Check, SwitchCamera } from 'lucide-react';

const CAMERA_CONSTRAINTS = { width: { ideal: 1920 }, height: { ideal: 1080 } };

export const CameraCapture = ({ onPhotosChange, photos = [], maxPhotos = 10 }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [facingMode, setFacingMode] = useState('environment'); // 'environment' = cámara trasera
    const [capturedPhoto, setCapturedPhoto] = useState(null);
    const [flash, setFlash] = useState(false);
    const [error, setError] = useState('');
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }, []);

    const startCamera = useCallback(async (mode) => {
        stopCamera();
        setError('');
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: mode, ...CAMERA_CONSTRAINTS },
            });
            streamRef.current = mediaStream;
            if (videoRef.current) videoRef.current.srcObject = mediaStream;
        } catch (err) {
            console.error('Error accessing camera:', err);
            setError('No se pudo acceder a la cámara. Verifica los permisos del navegador.');
        }
    }, [stopCamera]);

    useEffect(() => () => stopCamera(), [stopCamera]);

    const openCamera = () => {
        setIsOpen(true);
        setCapturedPhoto(null);
        // Espera a que el video esté montado en la pantalla completa
        setTimeout(() => startCamera(facingMode), 150);
    };

    const closeCamera = () => {
        stopCamera();
        setCapturedPhoto(null);
        setIsOpen(false);
    };

    const switchCamera = () => {
        const next = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(next);
        startCamera(next);
    };

    const takePhoto = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !video.videoWidth) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.75));
        stopCamera();
    };

    const retakePhoto = () => {
        setCapturedPhoto(null);
        setTimeout(() => startCamera(facingMode), 50);
    };

    const confirmPhoto = () => {
        if (!capturedPhoto || photos.length >= maxPhotos) return;
        const newPhotos = [...photos, capturedPhoto];
        onPhotosChange(newPhotos);
        setCapturedPhoto(null);
        // Sigue tomando fotos hasta el máximo
        if (newPhotos.length < maxPhotos) setTimeout(() => startCamera(facingMode), 50);
        else closeCamera();
    };

    const removePhoto = (index) => {
        onPhotosChange(photos.filter((_, i) => i !== index));
    };

    const lastPhoto = photos[photos.length - 1];

    return (
        <div className="space-y-3">
            {/* Fotos tomadas */}
            {photos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                    {photos.map((photo, index) => (
                        <div key={index} className="relative group aspect-square">
                            <img
                                src={photo}
                                alt={`Foto ${index + 1}`}
                                className="w-full h-full object-cover rounded-lg border"
                            />
                            <button
                                type="button"
                                onClick={() => removePhoto(index)}
                                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="w-4 h-4" />
                            </button>
                            <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                {index + 1}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <Button
                type="button"
                variant="outline"
                onClick={openCamera}
                disabled={photos.length >= maxPhotos}
                className="w-full"
                data-testid="open-camera-btn"
            >
                <Camera className="w-4 h-4 mr-2" />
                {photos.length === 0
                    ? 'Tomar Fotos'
                    : `Agregar Foto (${photos.length}/${maxPhotos})`
                }
            </Button>

            <FullscreenCamera
                open={isOpen}
                onClose={closeCamera}
                title={capturedPhoto ? 'Revisa la foto' : `Foto ${Math.min(photos.length + 1, maxPhotos)} de ${maxPhotos}`}
                subtitle="Revisión 360° · encuadra bien el vehículo"
                testId="camera-fullscreen"
                topRight={photos.length > 0 && !capturedPhoto ? (
                    <button
                        type="button"
                        onClick={closeCamera}
                        className="h-11 px-4 rounded-full bg-white text-black font-medium text-sm active:scale-95"
                        data-testid="camera-done-btn"
                    >
                        Listo ({photos.length})
                    </button>
                ) : null}
                bottom={!capturedPhoto ? (
                    <div className="flex items-center justify-between max-w-md mx-auto">
                        <div className="w-14 h-14 rounded-lg overflow-hidden border-2 border-white/60 bg-white/10 flex items-center justify-center text-xs">
                            {lastPhoto ? <img src={lastPhoto} alt="Última foto" className="w-full h-full object-cover" /> : `0/${maxPhotos}`}
                        </div>
                        <button
                            type="button"
                            onClick={takePhoto}
                            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95"
                            aria-label="Tomar foto"
                            data-testid="capture-btn"
                        >
                            <span className="w-16 h-16 rounded-full bg-white" />
                        </button>
                        <button
                            type="button"
                            onClick={switchCamera}
                            className="w-14 h-14 rounded-full bg-black/50 border border-white/30 flex items-center justify-center active:scale-95"
                            aria-label="Cambiar cámara"
                            data-testid="switch-camera-btn"
                        >
                            <SwitchCamera className="w-6 h-6" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 max-w-md mx-auto">
                        <Button type="button" variant="outline" onClick={retakePhoto} className="flex-1 h-14 text-base bg-black/40 border-white/40 text-white hover:bg-black/60 hover:text-white" data-testid="retake-btn">
                            <RotateCcw className="w-5 h-5 mr-2" />
                            Repetir
                        </Button>
                        <Button type="button" onClick={confirmPhoto} className="flex-1 h-14 text-base brand-glow" data-testid="confirm-photo-btn">
                            <Check className="w-5 h-5 mr-2" />
                            Guardar
                        </Button>
                    </div>
                )}
            >
                {!capturedPhoto ? (
                    <video
                        ref={(el) => {
                            videoRef.current = el;
                            if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
                        }}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        data-testid="camera-preview"
                    />
                ) : (
                    <img src={capturedPhoto} alt="Foto capturada" className="w-full h-full object-contain bg-black" />
                )}
                {flash && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm">
                        <p className="bg-black/70 rounded-lg p-4">{error}</p>
                    </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
            </FullscreenCamera>
        </div>
    );
};
