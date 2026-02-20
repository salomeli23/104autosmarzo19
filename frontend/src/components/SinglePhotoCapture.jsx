import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Camera, X, RotateCcw, Check } from 'lucide-react';

export const SinglePhotoCapture = ({ onCapture, onClose }) => {
    const [stream, setStream] = useState(null);
    const [capturedPhoto, setCapturedPhoto] = useState(null);
    const [error, setError] = useState(null);
    const [facingMode, setFacingMode] = useState('environment');
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    const startCamera = async () => {
        try {
            setError(null);
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        } catch (err) {
            console.error('Error accessing camera:', err);
            setError('No se pudo acceder a la cámara. Verifica los permisos.');
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    };

    useEffect(() => {
        startCamera();
        return () => {
            stopCamera();
        };
    }, [facingMode]);

    const switchCamera = () => {
        stopCamera();
        setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    };

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            const photoData = canvas.toDataURL('image/jpeg', 0.8);
            setCapturedPhoto(photoData);
            stopCamera();
        }
    };

    const retakePhoto = () => {
        setCapturedPhoto(null);
        startCamera();
    };

    const confirmPhoto = () => {
        if (capturedPhoto) {
            onCapture(capturedPhoto);
        }
    };

    const handleClose = () => {
        stopCamera();
        onClose?.();
    };

    if (error) {
        return (
            <div className="p-4 rounded-lg bg-destructive/20 text-center">
                <p className="text-destructive text-sm mb-3">{error}</p>
                <div className="flex gap-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => startCamera()}>
                        Reintentar
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleClose}>
                        Cancelar
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                {!capturedPhoto ? (
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <img 
                        src={capturedPhoto} 
                        alt="Foto capturada"
                        className="w-full h-full object-cover"
                    />
                )}
                <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex items-center justify-center gap-3">
                {!capturedPhoto ? (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={switchCamera}
                        >
                            <RotateCcw className="w-4 h-4" />
                        </Button>
                        <Button
                            type="button"
                            size="lg"
                            className="w-14 h-14 rounded-full brand-glow"
                            onClick={takePhoto}
                            data-testid="take-photo-btn"
                        >
                            <Camera className="w-6 h-6" />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleClose}
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={retakePhoto}
                        >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Repetir
                        </Button>
                        <Button
                            type="button"
                            onClick={confirmPhoto}
                            className="brand-glow"
                            data-testid="confirm-single-photo-btn"
                        >
                            <Check className="w-4 h-4 mr-2" />
                            Usar Foto
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};

export default SinglePhotoCapture;
