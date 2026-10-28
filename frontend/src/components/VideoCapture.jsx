import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { FullscreenCamera } from './FullscreenCamera';
import { Video, RotateCcw, Check } from 'lucide-react';

// ~1.2 Mbps → un video de 20 s pesa unos 3 MB
const VIDEO_BITS_PER_SECOND = 1_200_000;

const pickMimeType = () => {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
};

/**
 * Graba un video de duración fija (por defecto 20 s) con la cámara trasera.
 * Props:
 *   video: { blob, url } | null — video ya grabado
 *   onVideoChange(video | null)
 *   durationSeconds: duración de la grabación
 */
export const VideoCapture = ({ video, onVideoChange, durationSeconds = 20 }) => {
    const [stream, setStream] = useState(null);
    const [recording, setRecording] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
    const [error, setError] = useState('');
    const previewRef = useRef(null);
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);

    const stopStream = useCallback(() => {
        setStream(prev => {
            prev?.getTracks().forEach(t => t.stop());
            return null;
        });
    }, []);

    useEffect(() => () => {
        clearInterval(timerRef.current);
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        stopStream();
    }, [stopStream]);

    // La vista previa se monta dentro de la pantalla completa: se conecta al aparecer el elemento
    const attachPreview = useCallback((el) => {
        previewRef.current = el;
        if (el && stream && el.srcObject !== stream) el.srcObject = stream;
    }, [stream]);

    const startCamera = async () => {
        setError('');
        if (pickMimeType() === null) {
            setError('Este navegador no permite grabar video.');
            return;
        }
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false,
            });
            setStream(s);
        } catch (e) {
            console.error('Error accessing camera:', e);
            setError('No se pudo acceder a la cámara. Verifica los permisos.');
        }
    };

    const finishRecording = () => {
        clearInterval(timerRef.current);
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    };

    const startRecording = () => {
        if (!stream) return;
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        });
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
            onVideoChange({ blob, url: URL.createObjectURL(blob) });
            setRecording(false);
            stopStream();
        };
        recorderRef.current = recorder;
        recorder.start(1000);
        setRecording(true);
        setSecondsLeft(durationSeconds);
        const startedAt = Date.now();
        timerRef.current = setInterval(() => {
            const left = durationSeconds - Math.floor((Date.now() - startedAt) / 1000);
            setSecondsLeft(Math.max(left, 0));
            if (left <= 0) finishRecording();
        }, 250);
    };

    const cancelCamera = () => {
        clearInterval(timerRef.current);
        if (recorderRef.current?.state === 'recording') {
            // Cancelar descarta lo grabado
            recorderRef.current.onstop = null;
            recorderRef.current.stop();
        }
        setRecording(false);
        stopStream();
    };

    const retake = () => {
        if (video?.url) URL.revokeObjectURL(video.url);
        onVideoChange(null);
        startCamera();
    };

    if (video) {
        return (
            <div className="space-y-3" data-testid="video-capture-done">
                <video src={video.url} controls playsInline className="w-full rounded-lg bg-black aspect-video" />
                <Button type="button" variant="outline" onClick={retake} className="w-full" data-testid="video-retake-btn">
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Grabar de nuevo
                </Button>
            </div>
        );
    }

    const progress = recording ? ((durationSeconds - secondsLeft) / durationSeconds) * 100 : 0;

    return (
        <div className="space-y-3" data-testid="video-capture">
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="button" variant="outline" onClick={startCamera} className="w-full" data-testid="video-open-camera-btn">
                <Video className="w-4 h-4 mr-2" />
                Abrir cámara para el video
            </Button>
            {!error && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Recorre el vehículo completo; la grabación dura {durationSeconds} segundos.
                </p>
            )}

            <FullscreenCamera
                open={!!stream}
                onClose={cancelCamera}
                title="Video 360°"
                subtitle={recording ? 'Recorre el vehículo completo' : `Se graban ${durationSeconds} segundos`}
                testId="video-fullscreen"
                bottom={(
                    <div className="max-w-md mx-auto space-y-3">
                        {recording && (
                            <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
                                <div className="h-full bg-red-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
                            </div>
                        )}
                        <div className="flex flex-col items-center gap-2">
                            {!recording ? (
                                <button
                                    type="button"
                                    onClick={startRecording}
                                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95"
                                    aria-label={`Grabar video de ${durationSeconds} segundos`}
                                    data-testid="video-record-btn"
                                >
                                    <span className="w-14 h-14 rounded-full bg-red-600" />
                                </button>
                            ) : (
                                <div
                                    className="w-20 h-20 rounded-full border-4 border-red-500 flex items-center justify-center"
                                    data-testid="video-recording-indicator"
                                >
                                    <span className="w-8 h-8 rounded bg-red-600 animate-pulse" />
                                </div>
                            )}
                            <p className="text-sm text-white/80">
                                {recording ? `Grabando… se detiene solo en ${secondsLeft}s` : `Toca para grabar ${durationSeconds} segundos`}
                            </p>
                        </div>
                    </div>
                )}
            >
                <video ref={attachPreview} autoPlay playsInline muted className="w-full h-full object-cover" data-testid="video-preview" />
                {recording && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 text-white text-lg font-mono px-4 py-1.5 rounded-full">
                        <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                        REC · {secondsLeft}s
                    </div>
                )}
            </FullscreenCamera>
        </div>
    );
};

export default VideoCapture;
